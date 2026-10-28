//! `Projection::apply` — the single state transition for every record, and
//! its one dispatch point; each record family's step lives in
//! `projection_records` (decisions in `projection_checks`, epochs in
//! `projection_steps`).
//!
//! A schema-v1 revision record has no provenance: after it applies, every
//! non-settled hunk of its document is blocked (`snapshotOnly`, origin
//! `schemaV1`). An `epochUnclosed` blocks them the same way
//! (`unclosedEpoch`, origin `restart`). Both are deterministic, so replay,
//! hydration and compaction reproduce them without stored spans.
//!
//! The writer validates before appending, so on the live path an error here
//! is a bug (the writer poisons itself). On replay or hydration an error
//! means the journal is corrupt. Review rules shared with validation come
//! from `review_rules`, so the two cannot drift. Every check runs before
//! the record changes anything (`projection_checks`), so an error leaves
//! the projection as it was. A receipt and an admission frame are checked
//! whole first (`admission::reduce`); the frame's items then apply in order
//! through this same `apply`, and a receipt is indexed by request id. An
//! item that fails in its own step leaves the items before it applied, so
//! an admission only ever applies where a failure discards the projection:
//! replay (the journal stays off) and staging (a clone); the writer refuses
//! to publish one without its staged projection (`admission::publish`).

use crate::agent_journal::admission::reduce::{check_decided_gen, preflight};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::*;
use crate::agent_journal::projection_checks::check_generation;
use crate::agent_journal::projection_steps::v1_block;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V1, SCHEMA_VERSION};
use crate::agent_journal::review::HunkState;

fn corrupt(what: impl Into<String>) -> TxnError {
    TxnError::Corrupt(what.into())
}

pub(super) fn bump(h: &mut HunkEntry, to: HunkState) -> Result<(), TxnError> {
    h.review_gen = h
        .review_gen
        .checked_add(1)
        .ok_or_else(|| corrupt("reviewGen overflow"))?;
    h.state = to;
    if to == HunkState::Settled {
        h.span = HunkEntry::creation_span(&h.hunk);
        h.blocked_at = None;
    }
    Ok(())
}

impl Projection {
    pub fn apply(&mut self, env: &Envelope) -> Result<(), TxnError> {
        if !(SCHEMA_V1..=SCHEMA_VERSION).contains(&env.schema_version) {
            return Err(corrupt(format!(
                "cannot apply schemaVersion {}",
                env.schema_version
            )));
        }
        let (seq, txn) = (env.seq, env.txn);
        check_generation(env)?;
        preflight(self, env)?;
        check_decided_gen(self, env)?;
        self.apply_record(env, seq, txn)?;
        if let Some(r) = &env.receipt {
            self.requests.insert(r.request_id, r.clone());
        }
        if env.schema_version == SCHEMA_V1 {
            if let Some(doc) = self.revision_doc(&env.record, txn) {
                let d = self
                    .docs
                    .get_mut(&doc)
                    .ok_or_else(|| corrupt("revision for unknown document"))?;
                d.block_live(&v1_block(), None);
            }
        }
        self.generation = self.generation.max(seq);
        self.started = true;
        Ok(())
    }

    /// The one dispatch point: each record family has its own
    /// preflight-and-apply step.
    fn apply_record(&mut self, env: &Envelope, seq: u64, txn: TxnId) -> Result<(), TxnError> {
        match &env.record {
            Record::JournalHeader { generation_floor } => {
                // Compaction writes one header, first: a later one could
                // only raise the generation the writer must count past.
                if self.started {
                    return Err(corrupt("a journalHeader after the first record"));
                }
                self.generation = *generation_floor;
            }
            Record::Prepared { .. }
            | Record::Aborted { .. }
            | Record::Uncommitted
            | Record::Discarded { .. }
            | Record::Committed { .. } => self.apply_txn_record(env, seq, txn)?,
            Record::PendingObservation { .. }
            | Record::ObservedRevision { .. }
            | Record::ConcurrentObservation { .. }
            | Record::Gap { .. } => self.apply_observation_record(env, seq, txn)?,
            Record::ReviewDecision {
                doc,
                expected_head,
                action,
                items,
            } => self.apply_decision(*doc, *expected_head, *action, items, env.schema_version)?,
            Record::Tombstone { .. } => self.apply_tombstone(env, seq, txn)?,
            Record::LegacyCheckpoint { .. } => self.apply_legacy(&env.record, seq)?,
            Record::EpochArmed { .. }
            | Record::EpochClosed { .. }
            | Record::EpochUnclosed { .. } => self.apply_epoch(&env.record)?,
            Record::CommentCreated(_)
            | Record::CommentReplied(_)
            | Record::CommentState(_)
            | Record::CommentDeleted(_) => self.comments.apply(env, &self.revisions)?,
            Record::Admission { items } => {
                for item in items {
                    self.apply(item)?;
                }
            }
        }
        Ok(())
    }
}
