//! The one WORD a claim and an abandonment race on (#227, #443, #444).
//!
//! Split from `sink.rs` at the file-size gate, and it is a real seam: this
//! half is three states and two compare-and-swaps, with no channel, no file
//! and no reporter in it. `sink.rs` owns the outcome lock that makes each
//! swap a single critical section together with the settled check — that
//! pairing is the invariant, and it stays there.
//!
//! @coordinates-with sink.rs — takes the outcome lock around every call here
//! @coordinates-with wait.rs — `abandon` is what a timeout does
//! @module pdf_export/renderer/sink_phase

use std::sync::atomic::{AtomicU8, Ordering};

/// The caller is waiting and the platform has not reached its irreversible step.
const PENDING: u8 = 0;
/// The platform claimed the irreversible step: a dialog is (about to be) on
/// screen, or a print is in flight.
const CLAIMED: u8 = 1;
/// The caller stopped waiting before the platform claimed.
const ABANDONED: u8 = 2;

/// What [`RenderSink::abandon`] found — the caller decides on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Abandoned {
    /// The platform had not claimed. Its `claim` now fails and it tears down.
    Marked,
    /// The platform claimed first. For a dialog that means it is on screen or
    /// about to be, and the time is the user's; for a render, the print is in
    /// flight and its file will be discarded on arrival.
    Claimed,
    /// The outcome had already been delivered when the caller gave up.
    Settled,
}

/// The claim/abandon word. `PENDING` until exactly one of the two swaps it.
#[derive(Default)]
pub(super) struct Phase(AtomicU8);

impl Phase {
    /// Swap `PENDING` → `CLAIMED`. `true` for the one caller that wins.
    pub(super) fn claim(&self) -> bool {
        self.0
            .compare_exchange(PENDING, CLAIMED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// Swap `PENDING` → `ABANDONED`, reporting what was already there.
    pub(super) fn abandon(&self) -> Abandoned {
        match self
            .0
            .compare_exchange(PENDING, ABANDONED, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => Abandoned::Marked,
            Err(CLAIMED) => Abandoned::Claimed,
            // Already abandoned: a second call is idempotent.
            Err(_) => Abandoned::Marked,
        }
    }

    /// Whether the caller gave up before the platform claimed. Read by
    /// `settle` inside the outcome lock, which is what makes it a
    /// linearization point rather than a sample.
    pub(super) fn is_abandoned(&self) -> bool {
        self.0.load(Ordering::SeqCst) == ABANDONED
    }
}
