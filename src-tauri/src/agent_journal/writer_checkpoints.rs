//! The frontend's checkpoint store, kept in the journal: each checkpoint is
//! one `legacyCheckpoint` record (idempotent by id), listed for hydration,
//! and forgotten by rewriting the journal without its record.
//!
//! Key decisions:
//!   - Forgetting is a deletion, not a hiding record: the rewrite drops the
//!     record and the pack compaction drops its text, unless another root
//!     (a revision, an open transaction, another checkpoint) still holds
//!     the same bytes. A clear is a privacy action.
//!   - It shares the collector's publication (`publish_rewrite`): replay
//!     checked against the expected projection before a byte is written,
//!     a header one generation past the live one, `Resync` on success.
//!   - It does not wait for reservations: checkpoint records are in no
//!     revision chain, and every in-flight transaction's records and queued
//!     blobs are kept as they are. The one exception is a prepared restore
//!     FROM a checkpoint: its commit is bound to that source, so forgetting
//!     the checkpoint is refused as busy until the restore ends.
//!
//! @module agent_journal/writer_checkpoints

use std::collections::BTreeSet;

use serde::Serialize;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::{Projection, TxnStatus};
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::review::{RestoreSource, ReviewOp};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::compact_unreached;

/// What one forget did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgetReport {
    /// Checkpoints removed from the journal.
    pub forgotten: usize,
    /// The pack compaction failed after the rewrite was published: the
    /// records are gone; their bytes go at the next compaction.
    pub blob_error: Option<String>,
}

impl Writer {
    /// Append one checkpoint line (the frontend's `MCPCheckpoint` JSON).
    /// `false` when the journal already holds that id.
    ///
    /// # Errors
    /// A line that does not parse as a checkpoint, or the writer's refusal.
    #[cfg(test)]
    pub fn append_checkpoint(&self, line: &str) -> Result<bool, TxnError> {
        Ok(self.migrate_legacy(&[line])? > 0)
    }

    /// Every checkpoint in the journal, in journal order.
    #[cfg(test)]
    pub fn legacy_entries(&self) -> Vec<(String, crate::agent_journal::projection::LegacyEntry)> {
        let g = self.lock();
        let mut out: Vec<_> = g
            .proj
            .legacy
            .iter()
            .map(|(id, e)| (id.clone(), e.clone()))
            .collect();
        out.sort_by_key(|(_, e)| e.seq);
        out
    }

    /// Delete the checkpoints `ids` names; unknown ids are ignored, and a
    /// call that finds none still retries a pack compaction an earlier
    /// failure left owing. See the module docs.
    ///
    /// # Errors
    /// The writer is corrupt or degraded, the journal cannot be read or
    /// rewritten, a reachable blob is missing (`Corrupt`), or the rewrite
    /// would not replay to the expected state.
    pub fn forget_legacy(&self, ids: &[String]) -> Result<ForgetReport, TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        let gone: BTreeSet<&String> = ids
            .iter()
            .filter(|id| g.proj.legacy.contains_key(*id))
            .collect();
        if gone.is_empty() {
            // Already forgotten: retry the compaction a failed one owes.
            return Ok(ForgetReport {
                forgotten: 0,
                blob_error: compact_unreached(&mut g)?,
            });
        }
        if let Some(holder) = restore_reading(&g.proj, &gone) {
            return Err(TxnError::JournalBusy { holder });
        }
        let floor = g.next_generation()?;
        let keep = |env: Envelope| {
            Ok(match &env.record {
                Record::LegacyCheckpoint { legacy_id, .. } if gone.contains(legacy_id) => None,
                _ => Some(env),
            })
        };
        let mut want = g.proj.clone();
        want.generation = floor;
        want.legacy.retain(|id, _| !gone.contains(id));
        let forgotten = gone.len();
        let blob_error = self.publish_rewrite(&mut g, &keep, &want, floor)?;
        log::info!("agent journal: forgot {forgotten} checkpoint(s)");
        Ok(ForgetReport {
            forgotten,
            blob_error,
        })
    }
}

/// A prepared restore whose source is one of the checkpoints `gone` names.
fn restore_reading(p: &Projection, gone: &BTreeSet<&String>) -> Option<TxnId> {
    p.txns.iter().find_map(|(txn, t)| match &t.review_op {
        ReviewOp::Restore {
            source: RestoreSource::LegacyCheckpoint { legacy_id },
        } if t.status == TxnStatus::Prepared && gone.contains(legacy_id) => Some(*txn),
        _ => None,
    })
}
