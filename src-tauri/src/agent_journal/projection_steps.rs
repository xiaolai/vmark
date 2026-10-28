//! The record-independent steps of `Projection::apply`: terminal status
//! moves, revision registration, linearization, effect application, and
//! the deterministic blocks (a schema-v1 revision, an `epochUnclosed`).
//! Split from `projection_apply` to keep the per-kind match readable.
//! Each step checks everything it could refuse before it changes anything,
//! so a refused record leaves the projection as it was.
//!
//! @module agent_journal/projection_steps

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::*;
use crate::agent_journal::projection_apply::bump;
use crate::agent_journal::provenance::{Block, BreakReason};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::{HunkState, LastCertified, ReviewEffects, ReviewOp};
use crate::agent_journal::review_rules::revert_target;

fn corrupt(what: impl Into<String>) -> TxnError {
    TxnError::Corrupt(what.into())
}

/// What a linearization record says, for [`Projection::linearize`].
pub(super) struct Linearization<'a> {
    pub revision: RevisionId,
    pub parent: Option<RevisionId>,
    /// The observation's preimage, repeated by concurrent and gap records.
    pub preimage: Option<&'a BlobHash>,
    /// The observation's base, repeated by a concurrent record.
    pub observed_parent: Option<&'a ObservedRef>,
    pub kind: RevisionKind,
    pub effects: &'a ReviewEffects,
}

/// The origin of the block a schema-v1 revision leaves.
const V1_ORIGIN: &str = "schemaV1";

/// The block a schema-v1 revision leaves: it carries no provenance map.
pub(super) fn v1_block() -> Block {
    Block::new(BreakReason::SnapshotOnly, V1_ORIGIN).expect("non-empty origin")
}

impl DocState {
    /// Sticky block on every non-settled hunk (first block wins). `at` is
    /// the revision whose span is the last certified one, if any. The
    /// barrier is the head: the revision record (or restart) that blocked.
    pub(super) fn block_live(&mut self, block: &Block, at: Option<RevisionId>) {
        let barrier = self.head;
        for h in self
            .hunks
            .values_mut()
            .filter(|h| h.state != HunkState::Settled && h.span.block.is_none())
        {
            h.span.last_certified = at.map(|at| LastCertified {
                at,
                range: h.span.range,
            });
            h.span.block = Some(block.clone());
            h.blocked_at = barrier;
        }
    }
}

impl Projection {
    /// The document whose head a revision-bearing record just moved.
    pub(super) fn revision_doc(&self, record: &Record, txn: TxnId) -> Option<DocId> {
        match record {
            Record::Committed { .. } => self.txns.get(&txn).map(|t| t.doc),
            Record::ObservedRevision { .. }
            | Record::ConcurrentObservation { .. }
            | Record::Gap { .. } => self.observations.get(&txn).map(|o| o.doc),
            Record::Tombstone { doc, .. } => Some(*doc),
            _ => None,
        }
    }

    /// `epochArmed` / `epochClosed` / `epochUnclosed`. Numbers are armed in
    /// order and closed once; an unclosed epoch blocks every live hunk
    /// (`unclosedEpoch`, origin `restart`), last certified at the head.
    pub(super) fn apply_epoch(&mut self, record: &Record) -> Result<(), TxnError> {
        match record {
            Record::EpochArmed { doc, epoch } => {
                let e = self.docs.get(doc).map(|d| &d.epoch);
                let (open, last) = e.map_or((None, 0), |e| (e.open, e.last));
                if open.is_some() || last.checked_add(1) != Some(*epoch) {
                    return Err(corrupt("epochArmed out of order"));
                }
                let e = &mut self.docs.entry(*doc).or_default().epoch;
                (e.last, e.open) = (*epoch, Some(*epoch));
            }
            Record::EpochClosed { doc, epoch } | Record::EpochUnclosed { doc, epoch } => {
                let d = self
                    .docs
                    .get_mut(doc)
                    .filter(|d| d.epoch.open == Some(*epoch))
                    .ok_or_else(|| corrupt("closing an epoch that is not open"))?;
                d.epoch.open = None;
                if matches!(record, Record::EpochUnclosed { .. }) {
                    let block =
                        Block::new(BreakReason::UnclosedEpoch, "restart").map_err(corrupt)?;
                    let head = d.head;
                    d.block_live(&block, head);
                }
            }
            _ => return Err(corrupt("not an epoch record")),
        }
        Ok(())
    }

    pub(super) fn set_status(
        &mut self,
        txn: TxnId,
        from: TxnStatus,
        to: TxnStatus,
    ) -> Result<(), TxnError> {
        let t = self
            .txns
            .get_mut(&txn)
            .ok_or_else(|| corrupt("terminal record for unknown transaction"))?;
        if t.status != from {
            return Err(corrupt(format!(
                "transaction is {:?}, expected {from:?}",
                t.status
            )));
        }
        t.status = to;
        Ok(())
    }

    /// Register `meta` and apply `effects`, after checking both: a refused
    /// record leaves the projection as it was.
    pub(super) fn add_revision(
        &mut self,
        meta: RevisionMeta,
        op: &ReviewOp,
        effects: &ReviewEffects,
    ) -> Result<(), TxnError> {
        self.check_new_revision(meta.id)?;
        self.check_effects(meta.doc, op, effects)?;
        let (doc, revision) = (meta.doc, meta.id);
        self.docs.entry(doc).or_default();
        self.revisions.insert(meta.id, meta);
        self.apply_effects(doc, revision, op, effects)
    }

    /// A linearization's bindings — the pending observation, the head as
    /// parent, its kind, and for a concurrent record the observation's own
    /// bases — are checked before anything changes.
    pub(super) fn linearize(
        &mut self,
        txn: TxnId,
        (seq, recorded_at): (u64, u64),
        l: Linearization<'_>,
    ) -> Result<(), TxnError> {
        let obs = self
            .observations
            .get(&txn)
            .filter(|o| o.linearized.is_none())
            .cloned()
            .ok_or_else(|| corrupt("linearization without a pending observation"))?;
        let d = self
            .docs
            .get(&obs.doc)
            .ok_or_else(|| corrupt("observation for unknown document"))?;
        let at = d
            .pending
            .iter()
            .position(|p| *p == txn)
            .ok_or_else(|| corrupt("observation not pending"))?;
        if l.parent != d.head {
            return Err(corrupt("linearization parent is not the head"));
        }
        if !self.kind_fits(&obs.observed_parent, d.head, l.kind) {
            return Err(corrupt("linearization kind contradicts its observation"));
        }
        if l.preimage.is_some_and(|pre| *pre != obs.observed_preimage)
            || l.observed_parent
                .is_some_and(|base| *base != obs.observed_parent)
        {
            return Err(corrupt("linearization bases differ from its observation"));
        }
        let meta = RevisionMeta {
            id: l.revision,
            doc: obs.doc,
            txn,
            seq,
            parent: l.parent,
            preimage: Some(obs.observed_preimage),
            postimage: obs.postimage,
            actor: obs.actor,
            review_op: ReviewOp::None,
            kind: l.kind,
            collected: false,
            at: recorded_at,
            addresses: Vec::new(),
        };
        self.add_revision(meta, &ReviewOp::None, l.effects)?;
        if let Some(d) = self.docs.get_mut(&obs.doc) {
            d.pending.remove(at);
        }
        if let Some(o) = self.observations.get_mut(&txn) {
            o.linearized = Some(l.revision);
        }
        Ok(())
    }

    /// Whether a save built on `base` is built on `head`; `None` for a
    /// pending base whose observation GC dropped (it could have been either).
    /// An unjournaled base never is.
    pub(crate) fn base_on_head(
        &self,
        base: &ObservedRef,
        head: Option<RevisionId>,
    ) -> Option<bool> {
        match base {
            ObservedRef::Revision { revision } => Some(head == Some(*revision)),
            ObservedRef::Pending { observation } => self
                .observations
                .get(observation)
                .map(|o| head.is_some() && o.linearized == head),
            ObservedRef::Genesis => Some(head.is_none()),
            ObservedRef::Unjournaled { .. } => Some(false),
        }
    }

    /// Whether `kind` is how the writer linearizes an observation built on
    /// `base` while the head is `head` (`writer_window`): on the head it is
    /// observed, an unjournaled base is a gap, anything else concurrent.
    fn kind_fits(&self, base: &ObservedRef, head: Option<RevisionId>, kind: RevisionKind) -> bool {
        if matches!(base, ObservedRef::Unjournaled { .. }) {
            return kind == RevisionKind::Gap;
        }
        let on_head = self.base_on_head(base, head);
        match kind {
            RevisionKind::Observed => on_head != Some(false),
            RevisionKind::Concurrent => on_head != Some(true),
            _ => false,
        }
    }

    /// Apply effects already checked (`projection_checks`).
    fn apply_effects(
        &mut self,
        doc: DocId,
        revision: RevisionId,
        op: &ReviewOp,
        e: &ReviewEffects,
    ) -> Result<(), TxnError> {
        let d = self
            .docs
            .get_mut(&doc)
            .ok_or_else(|| corrupt("revision for unknown document"))?;
        for t in &e.transitions {
            let h = d
                .hunks
                .get_mut(&t.hunk_id)
                .ok_or_else(|| corrupt("transition for unknown hunk"))?;
            bump(h, t.to)?;
        }
        for s in &e.spans {
            let h = d
                .hunks
                .get_mut(&s.hunk_id)
                .ok_or_else(|| corrupt("span for unknown hunk"))?;
            if h.span.block.is_none() && s.block.is_some() {
                h.blocked_at = Some(revision);
            }
            h.span = s.clone();
        }
        for h in &e.new_hunks {
            if d.hunks
                .insert(h.id.clone(), HunkEntry::new(h.clone()))
                .is_some()
            {
                return Err(corrupt("duplicate hunk"));
            }
        }
        if let ReviewOp::HunkRevert { hunk_id, .. } = op {
            let h = d
                .hunks
                .get_mut(hunk_id)
                .ok_or_else(|| corrupt("revert of unknown hunk"))?;
            let to = revert_target(h.state).ok_or_else(|| corrupt("illegal revert"))?;
            bump(h, to)?;
            h.attached_revert = Some(revision);
        }
        d.head = Some(revision);
        Ok(())
    }
}
