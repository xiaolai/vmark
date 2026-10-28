//! Observational capture (human saves): `pendingObservation` is durable
//! first and may be appended while another transaction holds the document;
//! linearization waits for the reservation and the degraded queue, then
//! appends exactly one of:
//! - `observedRevision` — the observed parent is the head;
//! - `concurrentObservation` — it is not: linear parent = head, attributed
//!   before-text = the observed preimage (both bases kept);
//! - `gap` — the observed parent was unjournaled text (a commit still in
//!   the degraded queue at capture time).
//!
//! A capture may carry its frozen provenance map, checked against its
//! observed base before the ack. Linearization maps every live span through
//! it only when the observed parent IS the head; a snapshot-only save is a
//! `snapshotOnly` barrier, and a concurrent observation or gap — whose map
//! does not start at the linear parent — a `parentMismatch` barrier
//! (`writer_window::linearization_window`).
//!
//! The capture stores its postimage AND its observed preimage before the
//! ack: the preimage may otherwise exist only in memory, in a queued
//! record that a crash discards. A durable capture of a window moves that
//! window's base root in the same critical section as its append. The observed origin is recorded apart from
//! the linear parent, which is chosen at linearization (the surviving head).

use crate::agent_journal::actor::Actor;
use crate::agent_journal::effects_rules::{check_effects, EffectsCtx};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::RevisionKind;
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::record::{GapReason, ObservedRef, Record};
use crate::agent_journal::review::{ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_degraded::Queued;
use crate::agent_journal::writer_derive::{linearize_ctx, LinearizeCtx};
use crate::agent_journal::writer_epoch::{check_payload, observed_basis};
use crate::agent_journal::writer_pins::set_window_base;

pub(crate) use crate::agent_journal::writer_base::{queued_text, resolve_base};

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObserveRequest {
    pub doc: DocId,
    pub actor: Actor,
    pub initiator: Actor,
    pub postimage: String,
    /// What the window's editor content was built on.
    pub observed_parent: ObservedRef,
    /// The frozen map observed text → postimage; `None` for a snapshot.
    #[serde(default)]
    pub provenance: Option<ProvenancePayload>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Journaled {
    /// Durable as `pendingObservation`, waiting for linearization.
    Pending,
    /// Not durable yet: queued in memory, retried by `retry_degraded`.
    No,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObserveOutcome {
    pub observation: TxnId,
    pub journaled: Journaled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearizeRequest {
    pub expected_head: Option<RevisionId>,
    /// Spans of every non-settled hunk mapped into the observation's
    /// postimage, plus `resolvedByHumanEdit` transitions.
    pub effects: ReviewEffects,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Linearized {
    pub observation: TxnId,
    pub revision: RevisionId,
    pub kind: RevisionKind,
}

impl Writer {
    #[cfg(test)]
    pub fn observe(&self, req: ObserveRequest) -> Result<ObserveOutcome, TxnError> {
        self.observe_for_window(req, None)
    }

    /// `observe` on behalf of a window's base root: a durable capture moves
    /// `window`'s base under the same lock as its append; a queued one moves
    /// it once the drainer lands it. A capture that would overflow the
    /// degraded budget is refused (`JOURNAL_DEGRADED`) with nothing queued.
    pub fn observe_for_window(
        &self,
        req: ObserveRequest,
        window: Option<&str>,
    ) -> Result<ObserveOutcome, TxnError> {
        self.observe_in(&mut self.lock(), req, window)
    }

    /// `observe_for_window` inside a caller's critical section.
    pub(crate) fn observe_in(
        &self,
        g: &mut Inner,
        req: ObserveRequest,
        window: Option<&str>,
    ) -> Result<ObserveOutcome, TxnError> {
        req.actor.validate().map_err(TxnError::InvalidRequest)?;
        req.initiator.validate().map_err(TxnError::InvalidRequest)?;
        let doc = req.doc;
        let (observed_parent, observed_preimage) = resolve_base(g, doc, req.observed_parent)?;
        if let Some(payload) = &req.provenance {
            let pre = base_text(g, doc, &observed_preimage)?;
            let basis = observed_basis(&observed_parent);
            check_payload(&g.proj, doc, &basis, &pre, &req.postimage, payload)?;
        }
        let observation = TxnId::new();
        let post = BlobHash::of_text(&req.postimage);
        let blobs = capture_blobs(g, doc, &observed_preimage, (post.clone(), req.postimage))?;
        let queued = Queued {
            txn: observation,
            record: Record::PendingObservation {
                doc,
                actor: req.actor,
                initiator: req.initiator,
                postimage: post,
                observed_parent,
                observed_preimage,
                provenance: req.provenance,
            },
            blobs,
            releases: false,
            window: window.map(str::to_owned),
        };
        let journaled = self.append_or_queue(g, doc, queued)?;
        if let (Journaled::Pending, Some(window)) = (journaled, window) {
            set_window_base(g, window, doc, ObservedRef::Pending { observation });
        }
        Ok(ObserveOutcome {
            observation,
            journaled,
        })
    }

    /// Append the capture, or queue it behind an earlier queued capture of
    /// the document (a later one may name it) or after a failed append. A
    /// queued terminal record does not block a capture.
    ///
    /// A failed append may have stored the capture's texts already: the
    /// queue then carries only the ones still missing (the record names
    /// them all, so they stay roots until it lands).
    fn append_or_queue(
        &self,
        g: &mut Inner,
        doc: DocId,
        mut queued: Queued,
    ) -> Result<Journaled, TxnError> {
        let behind = g
            .degraded
            .get(&doc)
            .is_some_and(|q| q.iter().any(|q| !q.releases));
        if !behind {
            let refs: Vec<(&BlobHash, &str)> =
                queued.blobs.iter().map(|(h, t)| (h, t.as_str())).collect();
            match self.append(g, queued.txn, queued.record.clone(), &refs) {
                Ok(_) => return Ok(Journaled::Pending),
                Err(TxnError::Io(_) | TxnError::Indeterminate(_)) => {
                    queued.blobs.retain(|(h, _)| !g.blobs.contains(h))
                }
                Err(e) => return Err(e),
            }
        }
        g.admit_queued_capture(&queued)?;
        g.degraded.entry(doc).or_default().push_back(queued);
        Ok(Journaled::No)
    }

    /// Linearize the oldest pending observation of `doc`, if any.
    pub fn linearize_next(
        &self,
        doc: DocId,
        req: LinearizeRequest,
    ) -> Result<Option<Linearized>, TxnError> {
        self.linearize_next_in(&mut self.lock(), doc, req)
    }

    /// `linearize_next` inside a caller's critical section.
    pub(crate) fn linearize_next_in(
        &self,
        g: &mut Inner,
        doc: DocId,
        req: LinearizeRequest,
    ) -> Result<Option<Linearized>, TxnError> {
        g.healthy()?;
        g.not_busy(doc)?;
        let Some(ctx) = linearize_ctx(g, doc)? else {
            return Ok(None);
        };
        if ctx.head != req.expected_head {
            return Err(TxnError::StaleParent { head: ctx.head });
        }
        let revision = RevisionId::new();
        let effects_ctx = EffectsCtx {
            doc: g.proj.docs.get(&doc),
            op: &ReviewOp::None,
            revision,
            parent: ctx.head,
            preimage: None,
            postimage: &ctx.post,
            window: &ctx.window,
            reverted: None,
        };
        check_effects(&effects_ctx, &req.effects)?;
        let (observation, kind) = (ctx.observation, ctx.kind);
        let record = linearized_record(ctx, revision, req.effects);
        self.append(g, observation, record, &[])?;
        Ok(Some(Linearized {
            observation,
            revision,
            kind,
        }))
    }
}

/// The record linearizing `ctx`'s observation as `revision`: on the head
/// it observed, on unjournaled text, or concurrent with the head.
pub(crate) fn linearized_record(
    ctx: LinearizeCtx,
    revision: RevisionId,
    effects: ReviewEffects,
) -> Record {
    let (parent, obs) = (ctx.head, ctx.entry);
    match (ctx.kind, obs.observed_parent) {
        (RevisionKind::Observed, _) => Record::ObservedRevision {
            revision,
            parent,
            effects,
        },
        (RevisionKind::Gap, _) => Record::Gap {
            revision,
            parent,
            observed_preimage: obs.observed_preimage,
            reason: GapReason::UnjournaledBase,
            effects,
        },
        (_, observed_parent) => Record::ConcurrentObservation {
            revision,
            parent,
            observed_parent,
            observed_preimage: obs.observed_preimage,
            effects,
        },
    }
}

/// The text of an observed preimage: stored (readable even through a
/// poisoned pack's old handle), or still only in `doc`'s queue.
fn base_text(g: &mut Inner, doc: DocId, hash: &BlobHash) -> Result<String, TxnError> {
    if g.blobs.readable(hash) {
        return g.blobs.get(hash);
    }
    queued_text(g, doc, hash)
        .ok_or_else(|| TxnError::Invariant("observed preimage text is not stored or queued".into()))
}

/// Every text the capture names, durable before the ack: the postimage,
/// and the observed preimage when the pack does not durably hold it (it
/// lives only in this document's queue, is genesis `""`, or the pack is
/// poisoned and its index untrusted) — once, even when it is the
/// postimage's own text.
fn capture_blobs(
    g: &mut Inner,
    doc: DocId,
    observed_preimage: &BlobHash,
    post: (BlobHash, String),
) -> Result<Vec<(BlobHash, String)>, TxnError> {
    let needs_preimage = *observed_preimage != post.0 && !g.blobs.contains(observed_preimage);
    let mut blobs = vec![post];
    if needs_preimage {
        let text = base_text(g, doc, observed_preimage)?;
        blobs.push((observed_preimage.clone(), text));
    }
    Ok(blobs)
}

#[cfg(test)]
#[path = "writer_observe.test.rs"]
mod tests;
