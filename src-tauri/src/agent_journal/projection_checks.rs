//! The checks `Projection::apply` makes before it changes anything, and
//! the review decision they guard. A record is refused whole: a duplicate
//! revision, an effect that names an unknown or stale hunk, or a decision
//! the writer would refuse (stale head or `reviewGen`, an empty batch, a
//! repeated hunk, a reserved generation, a revert outcome on a blocked
//! hunk) leaves the projection exactly as it was. The writer validates the same rules before
//! it appends (`review_rules`, `effects_rules`), so on the live path a
//! refusal here is a bug and on replay it is corruption.
//!
//! `u64::MAX` is never a generation, so the writer's `generation + 1`
//! cannot wrap.
//!
//! @module agent_journal/projection_checks

use std::collections::{BTreeMap, BTreeSet};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::projection::{DocState, Projection};
use crate::agent_journal::projection_apply::bump;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V1};
use crate::agent_journal::review::{
    Hunk, HunkState, ReviewAction, ReviewEffects, ReviewItem, ReviewOp,
};
use crate::agent_journal::review_rules::{
    capture_target, check_decision_gated, decision_target, new_hunks_fit, revert_target,
};

fn corrupt(what: impl Into<String>) -> TxnError {
    TxnError::Corrupt(what.into())
}

/// `u64::MAX` is reserved: the writer's next generation is one past the
/// last, so a record holding it (as its `seq` or a header's floor) could
/// only wrap.
pub(super) fn check_generation(env: &Envelope) -> Result<(), TxnError> {
    let floor = match env.record {
        Record::JournalHeader { generation_floor } => generation_floor,
        _ => 0,
    };
    if env.seq == u64::MAX || floor == u64::MAX {
        return Err(corrupt("generation u64::MAX is reserved"));
    }
    Ok(())
}

/// What a revision record's effects are shaped by.
pub(super) struct EffectShape<'a> {
    pub doc: DocId,
    pub op: &'a ReviewOp,
    pub revision: RevisionId,
    pub parent: Option<RevisionId>,
    /// Whether the record carries spans (a tombstone does not).
    pub spans: bool,
}

impl Projection {
    /// Refuse a revision id already registered, without changing anything.
    pub(super) fn check_new_revision(&self, id: RevisionId) -> Result<(), TxnError> {
        if self.revisions.contains_key(&id) {
            return Err(corrupt("duplicate revision"));
        }
        Ok(())
    }

    /// A `prepared` as `Writer::prepare` admits it: a fresh transaction on
    /// the head, its preimage the head text, its planned revision unused.
    pub(super) fn check_prepared(
        &self,
        txn: TxnId,
        doc: DocId,
        parent: Option<RevisionId>,
        revision: RevisionId,
        preimage: &BlobHash,
    ) -> Result<(), TxnError> {
        if self.txns.contains_key(&txn) {
            return Err(corrupt("duplicate prepared"));
        }
        self.check_on_head(doc, parent, "prepared")?;
        if self.postimage_of(parent).as_ref() != Some(preimage) {
            return Err(corrupt("prepared preimage is not the head text"));
        }
        self.check_new_revision(revision)
    }

    /// Refuse a controlled step whose parent is not the document's head.
    pub(super) fn check_on_head(
        &self,
        doc: DocId,
        parent: Option<RevisionId>,
        what: &str,
    ) -> Result<(), TxnError> {
        if parent != self.head(doc) {
            return Err(corrupt(format!("{what} off the head")));
        }
        Ok(())
    }

    /// Every refusal `apply_effects` could make, without mutating: each
    /// transition names a hunk at its `expectedReviewGen` (once), each span
    /// a known hunk, each new hunk a fresh id, and a revert a legal target.
    pub(super) fn check_effects(
        &self,
        doc: DocId,
        op: &ReviewOp,
        e: &ReviewEffects,
    ) -> Result<(), TxnError> {
        // A tombstone may be the first record of its document.
        let empty = DocState::default();
        let d = self.docs.get(&doc).unwrap_or(&empty);
        let mut moved = BTreeMap::new();
        for t in &e.transitions {
            let h = d
                .hunks
                .get(&t.hunk_id)
                .ok_or_else(|| corrupt("transition for unknown hunk"))?;
            if h.review_gen != t.expected_review_gen {
                return Err(corrupt("transition at a stale reviewGen"));
            }
            if moved.insert(&t.hunk_id, t.to).is_some() {
                return Err(corrupt("duplicate transition"));
            }
            h.review_gen
                .checked_add(1)
                .ok_or_else(|| corrupt("reviewGen overflow"))?;
        }
        if let Some(s) = e.spans.iter().find(|s| !d.hunks.contains_key(&s.hunk_id)) {
            return Err(corrupt(format!("span for unknown hunk {}", s.hunk_id.0)));
        }
        let mut fresh = BTreeSet::new();
        if !e
            .new_hunks
            .iter()
            .all(|h| !d.hunks.contains_key(&h.id) && fresh.insert(&h.id))
        {
            return Err(corrupt("duplicate hunk"));
        }
        if let ReviewOp::HunkRevert { hunk_id, .. } = op {
            let (state, gen) = match (d.hunks.get(hunk_id), moved.get(hunk_id)) {
                (Some(h), Some(to)) => (*to, h.review_gen.saturating_add(1)),
                (Some(h), None) => (h.state, h.review_gen),
                (None, _) if fresh.contains(hunk_id) => (HunkState::Pending, 0),
                (None, _) => return Err(corrupt("revert of unknown hunk")),
            };
            revert_target(state).ok_or_else(|| corrupt("illegal revert"))?;
            gen.checked_add(1)
                .ok_or_else(|| corrupt("reviewGen overflow"))?;
        }
        Ok(())
    }

    /// The structural half of the writer's `effects_rules`, the part replay
    /// can check without texts or provenance: each transition goes where
    /// the op's capture sends a pending or conflicted hunk
    /// (`capture_target`), the spans cover exactly the hunks not settled
    /// before the record (a tombstone's were dropped by the collector), and
    /// the new hunks are the op's kind and count, of this revision on this
    /// parent, under their canonical id — within the free slots, by the
    /// same rule the writer admits them under (`new_hunks_fit`).
    pub(super) fn check_effect_shape(
        &self,
        s: &EffectShape<'_>,
        e: &ReviewEffects,
    ) -> Result<(), TxnError> {
        let empty = DocState::default();
        let d = self.docs.get(&s.doc).unwrap_or(&empty);
        for t in &e.transitions {
            let from = d.hunks.get(&t.hunk_id).map(|h| h.state);
            if from.and_then(|f| capture_target(s.op, f)) != Some(t.to) {
                return Err(corrupt("a transition this revision cannot make"));
            }
        }
        if s.spans {
            let mut spanned = BTreeSet::new();
            if !e.spans.iter().all(|x| spanned.insert(&x.hunk_id)) {
                return Err(corrupt("duplicate span"));
            }
            let live = d
                .hunks
                .iter()
                .filter(|(_, h)| h.state != HunkState::Settled);
            if !spanned.iter().copied().eq(live.map(|(id, _)| id)) {
                return Err(corrupt("spans do not cover exactly the live hunks"));
            }
        }
        if !new_hunks_fit(s.op, d.non_settled(), &e.new_hunks) {
            return Err(corrupt("new hunks this op does not make"));
        }
        let foreign = |h: &&Hunk| h.target != s.revision || h.base != s.parent;
        if e.new_hunks
            .iter()
            .any(|h| foreign(&h) || !h.id_is_consistent())
        {
            return Err(corrupt(
                "a new hunk of another revision or under a forged id",
            ));
        }
        Ok(())
    }

    /// A decision is checked whole, by the writer's own rules
    /// (`review_rules::check_decision`), before any hunk changes. Only its
    /// revert-outcome gate differs: replay refuses a block, never a span
    /// collision, because GC drops collected revisions' spans and a
    /// tombstoned history may place a hunk where the live one did not. A
    /// decision recorded under schema v1 is exempt: v1 had no blocks, so its
    /// revert outcomes were legal when written. GC keeps every record's
    /// version, so the exemption never reaches a v2 decision.
    pub(super) fn apply_decision(
        &mut self,
        doc: DocId,
        expected_head: Option<RevisionId>,
        action: ReviewAction,
        items: &[ReviewItem],
        schema_version: u32,
    ) -> Result<(), TxnError> {
        let d = self
            .docs
            .get_mut(&doc)
            .ok_or_else(|| corrupt("decision for unknown document"))?;
        if d.head != expected_head {
            return Err(corrupt("decision against a stale head"));
        }
        let gate = |d: &DocState, id: &HunkId| match schema_version {
            SCHEMA_V1 => Ok(()),
            _ => replay_gate(d, id),
        };
        check_decision_gated(Some(&*d), action, items, gate)
            .map_err(|e| corrupt(format!("a decision the writer refuses: {e}")))?;
        for item in items {
            let h = d
                .hunks
                .get_mut(&item.hunk_id)
                .ok_or_else(|| corrupt("decision for unknown hunk"))?;
            let to = decision_target(action, h.state).ok_or_else(|| corrupt("illegal decision"))?;
            bump(h, to)?;
        }
        Ok(())
    }
}

/// The replay half of `revert_gate::gate`: a blocked hunk has no revert
/// outcome.
fn replay_gate(d: &DocState, id: &HunkId) -> Result<(), TxnError> {
    match d.hunks.get(id).and_then(|h| h.span.block.as_ref()) {
        Some(_) => Err(corrupt("a revert outcome on a blocked hunk")),
        None => Ok(()),
    }
}

#[cfg(test)]
#[path = "projection_replay.test.rs"]
mod replay_tests;
