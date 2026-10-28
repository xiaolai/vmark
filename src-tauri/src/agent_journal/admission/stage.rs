//! Staging a multi-record prepare as one `admission` frame: every pending
//! capture of the document linearized, the buffer recorded as a human
//! baseline (its observation and linearization) when it is needed, then
//! the `prepared` with its reply and receipt — or, for a revert that does
//! not apply, the review decision it records. A frame of one item (a
//! revert with nothing before it) is written as that item. Each item is checked and
//! applied to a clone of the projection, reading texts through the pack
//! overlaid with the blobs the frame will store, so every item derives
//! from exactly the state the replay will have reached. The live
//! projection, the pack and the journal are untouched until the publish;
//! a refusal here drops the clone and the staged blobs. Staging is handed
//! the projection read-only and the pack, never `&mut Inner`, so it cannot
//! reach a writer helper that mutates state (window bases, the budget's
//! unpinned sets, the degraded queue).
//!
//! @module agent_journal/admission/stage

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::blobs::StagedBlobs;
use crate::agent_journal::admission::observed_base::observed_base;
use crate::agent_journal::admission::prepare::{
    needs_baseline, prepare_request, Minted, Request, Responder,
};
use crate::agent_journal::admission::prepared_record::{prepared_record, revert_decision, Mint};
use crate::agent_journal::admission::publish::Staging;
use crate::agent_journal::admission::receipt::{Outcome, Receipt};
use crate::agent_journal::admission::reduce::preflight;
use crate::agent_journal::blob_store::BlobStore;
use crate::agent_journal::controlled::Prep;
use crate::agent_journal::controlled_revert::RevertDecided;
use crate::agent_journal::effects_rules::{check_effects, EffectsCtx};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V3, SCHEMA_V4};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::schema_table::{label, receipt_min};
use crate::agent_journal::writer::certificate::bind_to_parent;
use crate::agent_journal::writer_derive::{derived, linearize_ctx_from};
use crate::agent_journal::writer_epoch::{check_payload, observed_basis};
use crate::agent_journal::writer_observe::linearized_record;
use crate::agent_journal::writer_revert::referenced_blob;
use crate::agent_journal::writer_types::now_ms;

/// The items staged so far, applied to `proj` as they are pushed.
pub(crate) struct Frame {
    pub(crate) proj: Projection,
    pub(crate) items: Vec<Envelope>,
    pub(crate) next_seq: u64,
    pub(crate) at: u64,
    /// The schema of every item and of the frame: v5 for a comment
    /// create, v4 when a revert's receipt is among them, v3 otherwise.
    pub(crate) schema: u32,
}

impl Frame {
    /// Stamp `record` as the next item, check it and apply it to the clone.
    pub(crate) fn push(&mut self, txn: TxnId, record: Record) -> Result<u64, TxnError> {
        self.push_receipted(txn, record, None)
    }

    pub(crate) fn push_receipted(
        &mut self,
        txn: TxnId,
        record: Record,
        receipt: Option<Receipt>,
    ) -> Result<u64, TxnError> {
        // `u64::MAX` is reserved (replay refuses it): the last legal
        // generation may be staged, and only a push after it refuses.
        let seq = Some(self.next_seq)
            .filter(|s| *s < u64::MAX)
            .ok_or_else(|| TxnError::Io("journal generation exhausted".into()))?;
        let env = Envelope {
            schema_version: self.schema,
            seq,
            txn,
            at: self.at,
            record,
            receipt,
        };
        self.proj
            .apply(&env)
            .map_err(|e| TxnError::Invariant(format!("staged item {seq}: {e}")))?;
        self.items.push(env);
        self.next_seq = seq + 1;
        Ok(seq)
    }

    /// Linearize every pending capture of `doc`, oldest first.
    pub(crate) fn linearize_pending(
        &mut self,
        blobs: &mut StagedBlobs<'_>,
        doc: DocId,
    ) -> Result<(), TxnError> {
        while let Some(ctx) = linearize_ctx_from(&self.proj, blobs, doc)? {
            let effects = derived(
                &self.proj,
                doc,
                ctx.head,
                &ReviewOp::None,
                &ctx.window,
                &ctx.post,
                Vec::new(),
            )?;
            let revision = RevisionId::new();
            check_effects(
                &EffectsCtx {
                    doc: self.proj.docs.get(&doc),
                    op: &ReviewOp::None,
                    revision,
                    parent: ctx.head,
                    preimage: None,
                    postimage: &ctx.post,
                    window: &ctx.window,
                    reverted: None,
                },
                &effects,
            )?;
            let observation = ctx.observation;
            self.push(observation, linearized_record(ctx, revision, effects))?;
        }
        Ok(())
    }

    /// The envelope to write: one item alone, relabelled with its own
    /// schema; more as one `admission` whose `txn` is the last item's.
    pub(crate) fn into_envelope(mut self) -> Result<(Envelope, Projection), TxnError> {
        if self.items.len() == 1 {
            let mut env = self.items.remove(0);
            env.schema_version = match &env.receipt {
                Some(r) => label(&env.record).max(receipt_min(r)),
                None => label(&env.record),
            };
            return Ok((env, self.proj));
        }
        let last = self
            .items
            .last()
            .ok_or_else(|| TxnError::Invariant("an empty admission".into()))?;
        let env = Envelope {
            schema_version: self.schema,
            seq: self.items[0].seq,
            txn: last.txn,
            at: self.at,
            record: Record::Admission { items: self.items },
            receipt: None,
        };
        Ok((env, self.proj))
    }
}

/// What staging may read: the live projection and the pack.
pub(crate) struct Live<'a> {
    pub proj: &'a Projection,
    pub pack: &'a mut BlobStore,
    /// The seq the frame's first item takes.
    pub next_seq: u64,
}

/// Stage the frame for a prepare of `doc` that appends more than one
/// record, from `live` (read-only but for pack reads). Runs after
/// admission, in the caller's critical section.
pub(crate) fn staged(
    live: Live<'_>,
    doc: DocId,
    prep: Prep,
    responder: &Responder,
    request: Option<&Request>,
) -> Result<Staging, TxnError> {
    let revert = matches!(prep.review_op, ReviewOp::HunkRevert { .. });
    let mut f = Frame {
        proj: live.proj.clone(),
        items: Vec::new(),
        next_seq: live.next_seq,
        at: now_ms(),
        schema: if revert && request.is_some() {
            SCHEMA_V4
        } else {
            SCHEMA_V3
        },
    };
    let mut blobs = StagedBlobs::new(live.pack);
    f.linearize_pending(&mut blobs, doc)?;
    let head = f.proj.head(doc);
    let baseline = if needs_baseline(&f.proj, head, &prep) {
        stage_baseline(&mut f, &mut blobs, doc, head, &prep)?;
        f.linearize_pending(&mut blobs, doc)?;
        f.proj.head(doc)
    } else {
        None
    };
    let parent = f.proj.head(doc);
    let (mut req, sent) = prepare_request(prep, doc, parent);
    let (certificate, fallback) =
        bind_to_parent(&f.proj, doc, parent, &req.preimage, sent)?.split();
    let certified = certificate.is_some();
    req.certificate = certificate;
    let (txn, response) = match prepared_record(&f.proj, &mut blobs, req)? {
        Mint::Prepared(r) => {
            blobs.stage(&r.preimage);
            let minted = Minted {
                txn: r.txn,
                revision: r.revision,
                generation: f.next_seq,
                baseline,
                certified,
                fallback_reason: fallback,
                revert: r.revert,
            };
            let response = Outcome::Prepared(responder.reply(&minted));
            f.push_receipted(r.txn, r.record, Responder::receipt(request, &response))?;
            (r.txn, response)
        }
        Mint::NotApplied {
            hunk,
            review_gen,
            decision,
        } => {
            let d = revert_decision(&f.proj, doc, &hunk, review_gen, &decision)?;
            let response = Outcome::Decision(RevertDecided {
                doc,
                hunk: d.hunk,
                action: d.action,
                review_gen: d.review_gen,
                generation: f.next_seq,
                baseline,
                head: d.head,
            });
            let txn = TxnId::new();
            f.push_receipted(txn, d.record, Responder::receipt(request, &response))?;
            (txn, response)
        }
    };
    let staged_blobs = blobs.into_staged();
    let (env, proj) = f.into_envelope()?;
    preflight(live.proj, &env)
        .map_err(|e| TxnError::Invariant(format!("staged admission: {e}")))?;
    Ok(Staging {
        env,
        blobs: staged_blobs,
        staged: Some(proj),
        doc,
        txn,
        response,
        fallback,
    })
}

/// Push the buffer's capture as a human observation of `head`, caused by
/// the initiator's write, with its texts staged and its map checked
/// against the head's text.
pub(crate) fn stage_baseline(
    f: &mut Frame,
    blobs: &mut StagedBlobs<'_>,
    doc: DocId,
    head: Option<RevisionId>,
    prep: &Prep,
) -> Result<(), TxnError> {
    let provenance = prep.baseline_provenance.clone();
    let (observed_parent, observed_preimage) = observed_base(&f.proj, doc, head, prep)?;
    if provenance.is_some() || !blobs_hold(blobs, &observed_preimage) {
        let pre = referenced_blob(blobs, &observed_preimage)?;
        if let Some(payload) = &provenance {
            let basis = observed_basis(&observed_parent);
            check_payload(&f.proj, doc, &basis, &pre, &prep.preimage, payload)?;
        }
        blobs.stage(&pre);
    }
    blobs.stage(&prep.preimage);
    let record = Record::PendingObservation {
        doc,
        actor: Actor::Human,
        initiator: prep.initiator.clone(),
        postimage: BlobHash::of_text(&prep.preimage),
        observed_parent,
        observed_preimage,
        provenance,
    };
    f.push(TxnId::new(), record)?;
    Ok(())
}

fn blobs_hold(blobs: &StagedBlobs<'_>, hash: &BlobHash) -> bool {
    use crate::agent_journal::admission::blobs::BlobRead as _;
    blobs.contains(hash)
}
