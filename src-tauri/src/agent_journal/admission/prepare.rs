//! A controlled prepare, end to end, inside the caller's one critical
//! section of the writer lock: the receipt lookup, the new-request checks,
//! the record or admission frame built in full (reply and receipt
//! included) before anything is written, the publish, and the capture seq
//! recorded only once the frame is durable.
//!
//! Order: a request id already receipted answers from its receipt (the
//! stored reply when its transaction is still executable and the payload
//! digest matches; the request's state otherwise, `reconcile`) before any
//! other check, since the
//! first attempt's own reservation and baseline would refuse an identical
//! retry. Then the addresses (`comment::addresses`), parent CAS, capture
//! seq, restore source, admission (healthy, not degraded or reserved, a
//! free reservation slot). The addresses of a published prepare wait on
//! the writer for its `committed` (`Inner::addresses`).
//!
//! Direct versus staged by record count: a prepare that appends exactly
//! one record (nothing pending, no baseline) is one top-level `prepared`;
//! anything more is one `admission` frame staged on a clone
//! (`admission::stage`). A revert is always staged, since its outcome — a
//! `prepared` or a review decision — is decided against the text its
//! baseline leaves; a frame of one item is written as that item. A
//! receipted envelope is labelled its outcome's schema (v3, or v4 for a
//! revert's).
//!
//! @module agent_journal/admission/prepare

use crate::agent_journal::admission::blobs::BlobRead;
use crate::agent_journal::admission::prepared_record::{prepared_record, RevertPatch};
use crate::agent_journal::admission::publish::Staging;
use crate::agent_journal::admission::receipt::{
    Outcome, PayloadDigest, PreparedResponse, Receipt, RequestId,
};
use crate::agent_journal::admission::reconcile::lookup;
use crate::agent_journal::admission::reduce::preflight;
use crate::agent_journal::admission::stage::{staged, Live};
use crate::agent_journal::comment::addresses;
use crate::agent_journal::controlled::Prep;
use crate::agent_journal::controlled_restore::{source_text, RestorePrepared};
use crate::agent_journal::controlled_revert::RevertPrepared;
use crate::agent_journal::controlled_wire::ControlledPrepared;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance::Certificate;
use crate::agent_journal::record::{Envelope, SCHEMA_V3};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::schema_table;
use crate::agent_journal::writer::certificate::{bind_to_parent, note_fallback, FallbackReason};
use crate::agent_journal::writer::{Inner, PrepareRequest, Writer};
use crate::agent_journal::writer_types::now_ms;

/// A request id with the digest of the raw payload that carried it.
#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub(crate) id: RequestId,
    pub(crate) digest: PayloadDigest,
}

impl Request {
    /// Pair a decoded request id with its payload's digest. An id with no
    /// digest is refused: the receipt could not tell a retry from a reuse.
    pub(crate) fn from_parts(
        id: Option<RequestId>,
        digest: Option<PayloadDigest>,
    ) -> Result<Option<Self>, TxnError> {
        match (id, digest) {
            (None, _) => Ok(None),
            (Some(id), Some(digest)) => Ok(Some(Self { id, digest })),
            (Some(_), None) => Err(TxnError::InvalidRequest(
                "a request id needs the digest of its raw payload".into(),
            )),
        }
    }
}

/// What the reply names once the `prepared` is minted.
pub(crate) struct Minted {
    pub(crate) txn: TxnId,
    pub(crate) revision: RevisionId,
    pub(crate) generation: u64,
    pub(crate) baseline: Option<RevisionId>,
    pub(crate) certified: bool,
    pub(crate) fallback_reason: Option<FallbackReason>,
    pub(crate) revert: Option<RevertPatch>,
}

/// The text a restore applies and the transaction it resolves.
pub(crate) type RestoreText = (String, Option<TxnId>);

/// Builds the wire reply for `doc` from a minted prepare.
pub(crate) struct Responder {
    pub(crate) doc: DocId,
    pub(crate) restore: Option<RestoreText>,
}

impl Responder {
    pub(crate) fn reply(&self, m: &Minted) -> PreparedResponse {
        if let Some(r) = &m.revert {
            return PreparedResponse::Revert(RevertPrepared {
                doc: self.doc,
                txn: m.txn,
                revision: m.revision,
                generation: m.generation,
                baseline: m.baseline,
                hunk: r.hunk.clone(),
                review_gen: r.review_gen,
                from: r.from,
                to: r.to,
                insert: r.insert.clone(),
                postimage_hash: r.postimage_hash.clone(),
            });
        }
        match &self.restore {
            None => PreparedResponse::Controlled(ControlledPrepared {
                doc: self.doc,
                txn: m.txn,
                revision: m.revision,
                generation: m.generation,
                baseline: m.baseline,
                certified: m.certified,
                fallback_reason: m.fallback_reason,
            }),
            Some((text, resolves)) => PreparedResponse::Restore(RestorePrepared {
                doc: self.doc,
                txn: m.txn,
                revision: m.revision,
                generation: m.generation,
                baseline: m.baseline,
                text: text.clone(),
                resolves: *resolves,
            }),
        }
    }

    /// The receipt `request` stores for `outcome`, if it has an id.
    pub(crate) fn receipt(request: Option<&Request>, outcome: &Outcome) -> Option<Receipt> {
        request.map(|r| Receipt {
            request_id: r.id,
            digest: r.digest.clone(),
            outcome: outcome.clone(),
        })
    }
}

/// Prepare `doc` in the held critical section `g`. See the module docs.
pub(crate) fn prepare_admitted(
    w: &Writer,
    g: &mut Inner,
    doc: DocId,
    mut prep: Prep,
    request: Option<Request>,
) -> Result<Outcome, TxnError> {
    if let Some(r) = &request {
        if let Some(stored) = lookup(g, r)? {
            return Ok(stored);
        }
    }
    addresses::check(&g.proj.comments, doc, &prep.addresses)?;
    let addresses = std::mem::take(&mut prep.addresses);
    let head = g.proj.head(doc);
    if prep.parent != head {
        return Err(TxnError::StaleParent { head });
    }
    if let Some(id) = &prep.capture {
        g.capture_seqs.check(id)?;
    }
    let restore = match &prep.review_op {
        ReviewOp::Restore { source } => Some(source_text(g, doc, &prep.review_op, source)?),
        _ => None,
    };
    g.healthy()?;
    g.not_busy(doc)?;
    g.admit_reservation()?;
    let responder = Responder { doc, restore };
    let capture = prep.capture.take();
    let pending = g.proj.docs.get(&doc).is_some_and(|d| !d.pending.is_empty());
    let revert = matches!(prep.review_op, ReviewOp::HunkRevert { .. });
    let staging = if revert || pending || needs_baseline(&g.proj, head, &prep) {
        let live = Live {
            next_seq: g.next_generation()?,
            proj: &g.proj,
            pack: &mut g.blobs,
        };
        staged(live, doc, prep, &responder, request.as_ref())?
    } else {
        direct(
            g,
            doc,
            prepare_request(prep, doc, head),
            &responder,
            request.as_ref(),
        )?
    };
    let (response, fallback, txn) = (staging.response.clone(), staging.fallback, staging.txn);
    w.publish(g, staging)?;
    if !addresses.is_empty() {
        g.addresses.insert(txn, addresses);
    }
    if let Some(r) = fallback {
        note_fallback(g, doc, r);
    }
    if let Some(id) = &capture {
        g.capture_seqs.record(id);
    }
    Ok(response)
}

/// Whether the buffer is recorded as a human baseline on `head`: it
/// differs from the head's text, or something says a person touched it
/// (the window's flag, or a map that deletes or breaks anything). Text
/// equality alone does not decide it: a deleted and retyped character is a
/// person's, not the agent's.
pub(crate) fn needs_baseline(p: &Projection, head: Option<RevisionId>, prep: &Prep) -> bool {
    let touched = prep.baseline_touched
        || prep
            .baseline_provenance
            .as_ref()
            .is_some_and(|m| !m.touches_nothing());
    touched || p.postimage_of(head).as_ref() != Some(&BlobHash::of_text(&prep.preimage))
}

/// The writer's prepare request on `parent`, and the certificate the
/// window sent (bound to `parent` by the caller).
pub(crate) fn prepare_request(
    prep: Prep,
    doc: DocId,
    parent: Option<RevisionId>,
) -> (PrepareRequest, Option<Certificate>) {
    let req = PrepareRequest {
        doc,
        parent,
        preimage: prep.preimage,
        actor: prep.actor,
        initiator: prep.initiator,
        tool: prep.tool,
        review_op: prep.review_op,
        certificate: None,
    };
    (req, prep.certificate)
}

/// The single top-level `prepared`, its reply and receipt built first.
fn direct(
    g: &mut Inner,
    doc: DocId,
    req: (PrepareRequest, Option<Certificate>),
    responder: &Responder,
    request: Option<&Request>,
) -> Result<Staging, TxnError> {
    let (mut req, sent) = req;
    let (certificate, fallback) =
        bind_to_parent(&g.proj, doc, req.parent, &req.preimage, sent)?.split();
    let certified = certificate.is_some();
    req.certificate = certificate;
    let blobs: &mut dyn BlobRead = &mut g.blobs;
    let r = prepared_record(&g.proj, blobs, req)?.prepared()?;
    let seq = g.next_generation()?;
    let minted = Minted {
        txn: r.txn,
        revision: r.revision,
        generation: seq,
        baseline: None,
        certified,
        fallback_reason: fallback,
        revert: r.revert,
    };
    let response = Outcome::Prepared(responder.reply(&minted));
    let receipt = Responder::receipt(request, &response);
    let env = Envelope {
        schema_version: match receipt {
            Some(_) => SCHEMA_V3,
            None => schema_table::label(&r.record),
        },
        seq,
        txn: r.txn,
        at: now_ms(),
        record: r.record,
        receipt,
    };
    preflight(&g.proj, &env).map_err(|e| TxnError::Invariant(format!("staged prepare: {e}")))?;
    Ok(Staging {
        env,
        blobs: vec![(r.pre, r.preimage)],
        staged: None,
        doc,
        txn: r.txn,
        response,
        fallback,
    })
}
