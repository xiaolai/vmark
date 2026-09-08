//! The execution ids recent runs have carried, so a caller cannot reuse one
//! (#264).
//!
//! Frontends pre-generate an execution id per run (a UUID) and subscribe to
//! its events before `run_workflow` resolves. An id is the key every event,
//! cancel and snapshot directory is matched on, so a caller that sent the
//! same id twice would have two runs' events indistinguishable and two runs'
//! snapshots in one directory. Validation at entry (`prepare::execution_id_for`)
//! settles the shape; this settles the reuse: a bounded memory of the ids
//! that were admitted, consulted when the next one is published.
//!
//! Bounded, because an id is a few dozen bytes and the process may run
//! thousands of workflows: the oldest is forgotten past the cap.
//!
//! **The bound is the contract, and this is not the durable half.** Two
//! harms follow a reused id, and they are guarded in different places:
//!
//!   - The SNAPSHOT namespace — the one that can destroy a user's recovery
//!     copy — is guarded on disk. `snapshots::create_snapshot_unless`
//!     creates `snap-<id>` with `create_dir`, not `create_dir_all`, so an id
//!     that already has a snapshot directory is refused however long ago it
//!     ran, and across restarts, where a memory of ids is empty
//!     (`snapshots.test.rs` pins both).
//!   - EVENT and CANCEL keys are guarded only here, and therefore only for
//!     the last `REMEMBERED` runs of one process. Past that a caller that
//!     deliberately re-sends an old id gets events a stale listener may also
//!     be subscribed to. That is a client bug, not a boundary: the frontend
//!     mints a fresh UUID per run, and any caller able to invoke
//!     `run_workflow` is already inside the trust boundary (see
//!     `commands.rs`, `workflow_engine_policy`). Growing the set or
//!     persisting it would trade unbounded state for that case; the on-disk
//!     guard already covers the one with consequences.
//!
//! @coordinates-with state.rs — `WorkflowRunnerState::begin_execution`
//! @module workflow::recent_ids

use std::collections::VecDeque;
use std::sync::Mutex;

/// How many ids are remembered.
const REMEMBERED: usize = 256;

#[derive(Default)]
pub(super) struct RecentExecutionIds {
    seen: Mutex<VecDeque<String>>,
}

impl RecentExecutionIds {
    /// Remember `id`. `true` when it was fresh (and is now remembered);
    /// `false` when a recent run already carried it.
    pub(super) fn remember(&self, id: &str) -> bool {
        let mut seen = self.seen.lock().unwrap_or_else(|p| p.into_inner());
        if seen.iter().any(|s| s == id) {
            return false;
        }
        if seen.len() >= REMEMBERED {
            seen.pop_front();
        }
        seen.push_back(id.to_string());
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_id_is_remembered_and_a_repeat_is_refused() {
        let ids = RecentExecutionIds::default();
        assert!(ids.remember("a"));
        assert!(ids.remember("b"));
        assert!(!ids.remember("a"), "a is already remembered");
        assert!(!ids.remember("b"));
    }

    #[test]
    fn the_memory_is_bounded_and_forgets_the_oldest_first() {
        let ids = RecentExecutionIds::default();
        for i in 0..REMEMBERED {
            assert!(ids.remember(&format!("id-{i}")));
        }
        assert!(!ids.remember("id-0"), "still remembered at the cap");
        assert!(
            ids.remember("one-more"),
            "a fresh id past the cap is admitted"
        );
        assert!(
            !ids.remember("id-1"),
            "only the oldest made room; the next-oldest is still held"
        );
        assert!(
            ids.remember("id-0"),
            "the oldest was forgotten to make room"
        );
    }
}
