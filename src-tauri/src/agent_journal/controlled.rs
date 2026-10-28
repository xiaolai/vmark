//! `document.write` on the controlled-mutation protocol, as a window drives
//! it: prepare (after recording unjournaled buffer text as a baseline),
//! then commit or abort. The window re-verifies its editor between prepare
//! and apply; this side only records what the window reports.
//!
//! Prepare, in order: actor is an MCP actor; a request id already
//! receipted is answered from its receipt; parent CAS against the revision
//! the window last saw; the capture seq; writer healthy, document not
//! degraded or reserved (nothing appended when refused); then pending
//! captures linearized, the buffer recorded as a human baseline when it
//! differs from the head, and the `prepared` (preimage = head text) —
//! written as one record, or as one admission frame when there is more
//! than one (`admission::prepare`). All of it is one writer critical
//! section, so a racing prepare cannot slip in after admission: the loser
//! is refused with nothing appended (ADR-AL6). Abort records why
//! re-verification failed.
//!
//! Review effects are derived by the writer, never sent by the window. A
//! commit is a `wholeDocumentWrite` barrier (every older live hunk
//! blocked, none silently moved) unless a `selection.set` certificate,
//! sent with the prepare or the commit, checks (`certificate`). The
//! baseline carries the map flushed for unsaved edits
//! (`baselineProvenance`); without one it is a `snapshotOnly` barrier. A
//! refused commit ends the transaction `uncommitted` (no retry).
//!
//! @module agent_journal/controlled

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::prepare::{prepare_admitted, Request};
use crate::agent_journal::admission::receipt::{
    Outcome, PayloadDigest, PreparedResponse, RequestId,
};
use crate::agent_journal::capture_seq::CaptureId;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::provenance::{Certificate, ProvenancePayload};
use crate::agent_journal::provenance_field::decode_field;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::writer::{CommitRequest, Durability, Inner, LinearizeRequest, Writer};
use crate::agent_journal::writer_derive::linearize_effects_in;
use crate::agent_journal::writer_txn::{open_txn, Authorize};
use std::cell::Cell;

use crate::agent_journal::controlled_restore::restored_uncommitted;
use crate::agent_journal::controlled_wire::{decode, ControlledCommitRequest};
pub use crate::agent_journal::controlled_wire::{
    decode_prepare, AbortReason, ControlledCommitted, ControlledPrepareRequest, ControlledPrepared,
    TOOL_MAX_BYTES,
};

/// Prepare a controlled write of `doc` sent with no request id (or none
/// that needs its digest). See the module docs for the order.
pub fn prepare_controlled(
    w: &Writer,
    doc: DocId,
    req: ControlledPrepareRequest,
) -> Result<ControlledPrepared, TxnError> {
    prepare_controlled_with(w, doc, req, None)
}

/// `prepare_controlled` with the digest of the raw payload, which a
/// request id's receipt stores.
pub fn prepare_controlled_with(
    w: &Writer,
    doc: DocId,
    req: ControlledPrepareRequest,
    digest: Option<PayloadDigest>,
) -> Result<ControlledPrepared, TxnError> {
    let id = req.request_id;
    prepare_kind(
        w,
        doc,
        id,
        digest,
        || controlled_prep(req),
        |o| match o {
            Outcome::Prepared(PreparedResponse::Controlled(p)) => Some(p),
            _ => None,
        },
    )
}

/// What `req` asks the writer to prepare, its actor checked and its
/// baseline map decoded.
pub(crate) fn controlled_prep(req: ControlledPrepareRequest) -> Result<Prep, TxnError> {
    req.actor.validate().map_err(TxnError::InvalidRequest)?;
    Ok(Prep {
        parent: req.parent,
        observed_parent: req.observed_parent,
        preimage: req.preimage,
        actor: req.actor.clone(),
        initiator: req.actor,
        tool: req.tool,
        review_op: ReviewOp::Review,
        baseline_provenance: decode_field(req.baseline_provenance)?,
        baseline_touched: req.baseline_touched,
        certificate: req.certificate,
        capture: req.capture,
        addresses: req.addresses,
    })
}

/// A request id whose receipt answers another kind of prepare.
pub(crate) fn reused_id() -> TxnError {
    TxnError::InvalidRequest("the request id answers another kind of prepare".into())
}

/// The unframed prepare of every kind: request, then `prep`, then admission
/// in one critical section; an outcome `accept` refuses is `reused_id`.
pub(crate) fn prepare_kind<T>(
    w: &Writer,
    doc: DocId,
    id: Option<RequestId>,
    digest: Option<PayloadDigest>,
    prep: impl FnOnce() -> Result<Prep, TxnError>,
    accept: impl FnOnce(Outcome) -> Option<T>,
) -> Result<T, TxnError> {
    let request = Request::from_parts(id, digest)?;
    let prep = prep()?;
    let outcome = prepare_admitted(w, &mut w.lock(), doc, prep, request)?;
    accept(outcome).ok_or_else(reused_id)
}

/// What a controlled prepare needs, whoever drives it.
pub(crate) struct Prep {
    pub(crate) parent: Option<RevisionId>,
    /// The frozen buffer's predecessor; the baseline is recorded on it.
    pub(crate) observed_parent: Option<ObservedRef>,
    pub(crate) preimage: String,
    pub(crate) actor: Actor,
    pub(crate) initiator: Actor,
    pub(crate) tool: String,
    pub(crate) review_op: ReviewOp,
    pub(crate) baseline_provenance: Option<ProvenancePayload>,
    pub(crate) baseline_touched: bool,
    pub(crate) certificate: Option<Certificate>,
    /// The provenance capture the window froze for this prepare.
    pub(crate) capture: Option<CaptureId>,
    /// The comments the write says it addresses (`comment::addresses`).
    pub(crate) addresses: Vec<CommentId>,
}

/// Linearize the oldest pending observation of `doc` with the effects the
/// writer derives for it. `None` when nothing is pending.
pub(crate) fn linearize_one(
    w: &Writer,
    doc: DocId,
    head: Option<RevisionId>,
) -> Result<Option<RevisionId>, TxnError> {
    linearize_one_in(w, &mut w.lock(), doc, head)
}

/// `linearize_one` inside a caller's critical section: the effects are
/// derived and appended under the same lock.
fn linearize_one_in(
    w: &Writer,
    g: &mut Inner,
    doc: DocId,
    head: Option<RevisionId>,
) -> Result<Option<RevisionId>, TxnError> {
    let Some(effects) = linearize_effects_in(g, doc)? else {
        return Ok(None);
    };
    let done = w.linearize_next_in(
        g,
        doc,
        LinearizeRequest {
            expected_head: head,
            effects,
        },
    )?;
    Ok(done.map(|l| l.revision))
}

/// Commit `txn` with the applied text: certified through a checked
/// selection certificate, else a `wholeDocumentWrite` barrier (a `restore`
/// barrier for a restore, which also resolves the uncommitted transaction
/// it restores — read from the prepared op, never sent).
///
/// The window commits only after applying, and never retries a refused
/// commit, so a refusal for a known open transaction also ends it as
/// `uncommitted` (releasing the reservation, or queued behind a failed
/// append). The refusal is still returned: the window reports the write
/// applied but not durable.
pub fn commit_controlled(
    w: &Writer,
    txn: TxnId,
    payload: &[u8],
) -> Result<ControlledCommitted, TxnError> {
    commit_controlled_with(w, txn, payload, None)
}

/// `commit_controlled`, asking `authorize` (the caller's ownership check)
/// before the effects are derived and again in the commit's own critical
/// section. A commit it refuses changes nothing: the transaction stays
/// open for its owner, or for the sweep.
pub(crate) fn commit_controlled_with(
    w: &Writer,
    txn: TxnId,
    payload: &[u8],
    authorize: Option<Authorize<'_>>,
) -> Result<ControlledCommitted, TxnError> {
    let doc = txn_doc(w, txn).ok_or_else(unknown_txn)?;
    let denied = Cell::new(false);
    let checked = |g: &Inner| -> Result<(), TxnError> {
        let out = authorize.map_or(Ok(()), |a| a(g));
        denied.set(out.is_err());
        out
    };
    if authorize.is_some() {
        let g = w.lock();
        if open_txn(&g, txn).is_ok() {
            checked(&g)?;
        }
    }
    let committed = decode::<ControlledCommitRequest>(payload).and_then(|req| {
        let sent = req.certificate.as_ref();
        let mut commit = CommitRequest {
            postimage: req.postimage,
            resolves: restored_uncommitted(w, txn),
            provenance: None,
            effects: Default::default(),
        };
        commit.effects = w.derive_commit_effects_with(txn, &commit, sent)?;
        w.commit_with(
            txn,
            commit,
            sent,
            authorize.map(|_| &checked as Authorize<'_>),
        )
    });
    match committed {
        Ok((out, certification)) => {
            let (certified, fallback_reason) = w.report_certification(doc, &certification);
            Ok(ControlledCommitted {
                doc,
                revision: out.revision,
                applied: out.applied,
                durable: out.durable,
                certified,
                fallback_reason,
            })
        }
        Err(e) => {
            if !denied.get() {
                end_unrecorded(w, txn, &e);
            }
            Err(e)
        }
    }
}

/// End a transaction whose commit was refused after the apply. A
/// transaction that is no longer open (already committed, or its terminal
/// record queued) is left as it is.
fn end_unrecorded(w: &Writer, txn: TxnId, cause: &TxnError) {
    match w.record_uncommitted(txn) {
        Ok(d) => log::error!(
            "agent journal: commit of {} refused after apply ({cause}); recorded uncommitted (durable: {})",
            txn.0,
            d.durable
        ),
        Err(e) => log::warn!(
            "agent journal: commit of {} refused ({cause}); transaction not open ({e})",
            txn.0
        ),
    }
}

/// Abort `txn` because re-verification failed. A failed append keeps the
/// reservation and queues the record (`durable: false`).
pub fn abort_controlled(
    w: &Writer,
    txn: TxnId,
    reason: AbortReason,
) -> Result<Durability, TxnError> {
    abort_controlled_with(w, txn, reason, None)
}

/// `abort_controlled`, asking `authorize` in the abort's critical section.
pub(crate) fn abort_controlled_with(
    w: &Writer,
    txn: TxnId,
    reason: AbortReason,
    authorize: Option<Authorize<'_>>,
) -> Result<Durability, TxnError> {
    txn_doc(w, txn).ok_or_else(unknown_txn)?;
    w.abort_with(txn, &reason.record_text(), authorize)
}

/// The document `txn` belongs to, if the journal knows the transaction.
pub fn txn_doc(w: &Writer, txn: TxnId) -> Option<DocId> {
    w.lock().proj.txns.get(&txn).map(|t| t.doc)
}

fn unknown_txn() -> TxnError {
    TxnError::InvalidRequest("transaction is not open".into())
}
