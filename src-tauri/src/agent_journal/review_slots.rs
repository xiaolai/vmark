//! Review slot limits: how many non-settled hunks a document may carry
//! before an agent change or a restore is refused, and the one check of a
//! transaction's new hunks against them.
//!
//! Split out of `review_rules` for size; `review_rules` re-exports these so
//! callers keep one import path. Pure, no I/O.

use crate::agent_journal::review::{Hunk, HunkKind, ReviewOp};

/// Non-settled hunks at which an agent change is refused.
pub const AGENT_SLOT_LIMIT: usize = 500;
/// Non-settled hunks at which a restore is refused.
pub const RESTORE_SLOT_LIMIT: usize = 600;

/// The slot limit `op` is held to, when it is full at `non_settled` live
/// hunks: a Review at the agent limit, a Restore at the restore limit. Live
/// preparation refuses exactly these (`check_prepare`), and
/// [`new_hunks_fit`] refuses them too, so the writer and replay answer as
/// preparation does — whatever hunks the op would add, none included.
pub fn full_slots(op: &ReviewOp, non_settled: usize) -> Option<usize> {
    let limit = match op {
        ReviewOp::Review => AGENT_SLOT_LIMIT,
        ReviewOp::Restore { .. } => RESTORE_SLOT_LIMIT,
        ReviewOp::None | ReviewOp::HunkRevert { .. } => return None,
    };
    (non_settled >= limit).then_some(limit)
}

/// Whether `new` hunks are what `op` makes, within the slots `non_settled`
/// live hunks leave: an op whose slots are full ([`full_slots`]) fits
/// nothing; otherwise any number of non-restore hunks up to the free agent
/// slots for a review, exactly one restore hunk within the free restore
/// slots for a restore, none otherwise. The one rule the writer's effects
/// validation and replay both apply, so the two cannot drift.
pub fn new_hunks_fit(op: &ReviewOp, non_settled: usize, new: &[Hunk]) -> bool {
    if full_slots(op, non_settled).is_some() {
        return false;
    }
    let n = new.len();
    let free = |limit: usize| limit.saturating_sub(non_settled);
    match op {
        ReviewOp::Review => {
            n <= free(AGENT_SLOT_LIMIT) && new.iter().all(|h| h.kind != HunkKind::Restore)
        }
        ReviewOp::Restore { .. } => {
            n == 1 && n <= free(RESTORE_SLOT_LIMIT) && new[0].kind == HunkKind::Restore
        }
        ReviewOp::None | ReviewOp::HunkRevert { .. } => n == 0,
    }
}
