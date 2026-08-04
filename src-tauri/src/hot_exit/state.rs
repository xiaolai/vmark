//! Hot exit's Tauri-managed state (WI-20).
//!
//! The pending-restore map every restoring window pulls from, plus the
//! capture serialization lock. Both were process-global statics
//! (`PENDING_RESTORE`, `RESTORE_TIMEOUT_HANDLE`, `CAPTURE_LOCK`), which is why
//! the coordinator's tests needed a file-wide serialization mutex and a
//! `clear_pending_restore()` preamble: they all shared one map. Restoration is
//! reached from an `AppHandle` on every path, so the state belongs to the app.
//!
//! @coordinates-with hot_exit/coordinator.rs — capture and restore orchestration
//! @coordinates-with hot_exit/commands.rs — the Tauri commands that read it
//! @coordinates-with lib.rs — `.manage(HotExitState::default())`
//! @module hot_exit::state

use super::session::WindowState;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// Identity of one restore round, and the way an obsolete round's timeout task
/// stands down.
///
/// This replaces the `generation: u64` counter the map used to carry. The
/// counter existed because the timeout task reached a process-global map and
/// had to prove, on waking 60s later, that the state it was about to clear was
/// still the one it was spawned for — a number returned by one function and
/// threaded by hand into another, plus a second static holding a `JoinHandle`
/// purely to `abort()` the previous task (and a `#[cfg(test)]` fork of that
/// handle's type, because the test runtime and the production runtime spawn
/// differently). A round that can simply be TOLD it is obsolete needs none of
/// that: starting a restore stands the previous round down, and a woken
/// timeout that finds itself cancelled does nothing.
#[derive(Clone, Debug, Default)]
pub(crate) struct RestoreRound(Arc<AtomicBool>);

impl RestoreRound {
    /// Stand this round down. Idempotent.
    fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Whether a newer restore has superseded this round.
    pub(crate) fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Pending restore state for multi-window restoration.
/// Windows pull their state from here on startup.
#[derive(Debug, Default)]
pub(crate) struct PendingRestore {
    /// Window states indexed by window label
    pub window_states: HashMap<String, WindowState>,
    /// Set of window labels that are expected to complete restoration
    pub expected_labels: HashSet<String>,
    /// Labels of windows that have completed restoration
    pub completed_windows: HashSet<String>,
    /// The round these three collections belong to. Guarded by the SAME mutex
    /// on purpose: "start a new round" and "replace the pending windows" are
    /// one atomic step, so there is no window in which a timeout task could
    /// see a new round against the old map.
    round: RestoreRound,
}

impl PendingRestore {
    /// Whether every expected window has completed.
    pub(crate) fn all_complete(&self) -> bool {
        !self.expected_labels.is_empty()
            && self
                .expected_labels
                .iter()
                .all(|label| self.completed_windows.contains(label))
    }

    /// Drop everything this round was tracking.
    pub(crate) fn clear(&mut self) {
        self.window_states.clear();
        self.expected_labels.clear();
        self.completed_windows.clear();
    }

    /// Stand the current round down and start a fresh one over an empty map.
    fn begin_round(&mut self) -> RestoreRound {
        self.round.cancel();
        self.round = RestoreRound::default();
        self.clear();
        self.round.clone()
    }
}

/// Hot exit's shared state, held by the Tauri app for the life of the process.
#[derive(Default)]
pub struct HotExitState {
    pending: Mutex<PendingRestore>,
    /// Serialization guard for the read-merge-write section of
    /// `hot_exit_capture`. Prevents TOCTOU races when two concurrent captures
    /// (e.g. restart + settings button) both read the previous session, merge
    /// independently, and clobber each other's result.
    capture: tokio::sync::Mutex<()>,
    /// The live restore-timeout task, so a superseded or finished round can
    /// stop paying for it (audit 20260803 §9).
    ///
    /// `RestoreRound` already makes an obsolete timeout a NO-OP, which is a
    /// correctness property and was mistaken for the whole story: the task
    /// still sleeps out its full 60 seconds holding an `AppHandle` clone before
    /// discovering it has nothing to do. Rapid restores (window-creation
    /// failure → retry, or a restore per launch in a long-lived process)
    /// stacked one such task each. Holding the handle costs one `Option` and
    /// makes "at most one armed safety net" an invariant instead of a hope.
    restore_timeout: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl HotExitState {
    /// Lock the pending-restore map.
    ///
    /// THE one place the poisoning policy is stated: a panicking task leaves
    /// the guarded maps internally consistent — they are three independent
    /// collections with no cross-field invariant a half-finished write could
    /// break — and refusing every later restore because an unrelated task
    /// unwound would lose the user's session, which is the outcome hot exit
    /// exists to prevent. So recover and carry on. (This used to be spelled
    /// out at three separate call sites, once with a log line and twice
    /// without.)
    fn pending(&self) -> MutexGuard<'_, PendingRestore> {
        self.pending.lock().unwrap_or_else(|poisoned| {
            log::warn!("[HotExit] Recovering from poisoned pending-restore mutex");
            poisoned.into_inner()
        })
    }

    /// Take the capture serialization lock (held across the read-merge-write
    /// section, hence async).
    pub(crate) async fn capture_lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.capture.lock().await
    }

    /// Begin a restore round: stand the previous round down, replace the
    /// pending map with `windows`, and return the new round for the timeout
    /// task to hold.
    pub(crate) fn store(
        &self,
        windows: impl IntoIterator<Item = (String, WindowState)>,
        expected: HashSet<String>,
    ) -> RestoreRound {
        let mut pending = self.pending();
        let round = pending.begin_round();
        pending.expected_labels = expected;
        for (label, window_state) in windows {
            pending.window_states.insert(label, window_state);
        }
        round
    }

    /// Stand the current round down and install a fresh one over an empty map.
    /// Used by the restore paths that abort partway through.
    pub(crate) fn begin_round(&self) -> RestoreRound {
        self.cancel_restore_timeout();
        self.pending().begin_round()
    }

    /// Clear the pending map WITHOUT ending the round: a completed restore has
    /// nothing left to hand out, and its timeout task is already a no-op
    /// because the map is empty.
    pub(crate) fn clear(&self) {
        self.pending().clear();
        self.cancel_restore_timeout();
    }

    /// Arm the safety net for the round that just started, standing down
    /// whatever the previous round left running.
    ///
    /// Taken by value: the state OWNS the task from here, so there is exactly
    /// one slot and no way to arm two.
    pub(crate) fn set_restore_timeout(&self, handle: tauri::async_runtime::JoinHandle<()>) {
        let previous = self.swap_restore_timeout(Some(handle));
        if let Some(previous) = previous {
            previous.abort();
        }
    }

    /// Stop the current safety net. Idempotent, and abort on a task that has
    /// already finished is a no-op — so the completion path may call it freely.
    fn cancel_restore_timeout(&self) {
        if let Some(handle) = self.swap_restore_timeout(None) {
            handle.abort();
        }
    }

    /// Replace the timeout slot and hand back what was there. Separate so the
    /// `abort()` happens with the slot's lock already released — `abort` is
    /// cheap but it is not this lock's business.
    fn swap_restore_timeout(
        &self,
        next: Option<tauri::async_runtime::JoinHandle<()>>,
    ) -> Option<tauri::async_runtime::JoinHandle<()>> {
        let mut slot = self
            .restore_timeout
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::replace(&mut slot, next)
    }

    /// The pending state for one window, or `None` when nothing is pending
    /// for it.
    pub(crate) fn window_state(&self, window_label: &str) -> Option<WindowState> {
        self.pending().window_states.get(window_label).cloned()
    }

    /// Record that a window finished restoring. Returns whether that completed
    /// the round (which also clears it). Only expected windows count.
    pub(crate) fn mark_complete(&self, window_label: &str) -> bool {
        let mut pending = self.pending();
        if pending.expected_labels.contains(window_label) {
            pending.completed_windows.insert(window_label.to_string());
        } else {
            log::warn!(
                "[HotExit] Ignoring completion from unexpected window: {}",
                window_label
            );
        }

        let all_done = pending.all_complete();
        if all_done {
            pending.clear();
        }
        drop(pending);
        if all_done {
            // The round is over; its 60s safety net has nothing left to guard.
            self.cancel_restore_timeout();
        }
        all_done
    }

    /// The restore-timeout safety net: drop the pending map if `round` is
    /// still current and windows are still outstanding. Returns the labels it
    /// gave up on, for the caller to log — `None` when it did nothing.
    ///
    /// **The stand-down check happens UNDER the lock** (audit 20260803 §2).
    /// Reading it first looked equivalent and was not: an obsolete timeout
    /// could pass the check, lose the lock to the restore that was taking over,
    /// and then clear the NEW round's windows — leaving that restore with
    /// nothing to hand out and its windows blank. `begin_round` cancels and
    /// replaces the map in one critical section, so taking the lock first makes
    /// the two orderings the only two possible outcomes: either this timeout
    /// expires the round it was spawned for, or it sees the cancellation.
    pub(crate) fn expire_round(&self, round: &RestoreRound) -> Option<Vec<String>> {
        let mut pending = self.pending();
        if round.is_cancelled() || pending.expected_labels.is_empty() {
            return None;
        }
        let incomplete: Vec<String> = pending
            .expected_labels
            .iter()
            .filter(|label| !pending.completed_windows.contains(*label))
            .cloned()
            .collect();
        pending.clear();
        Some(incomplete)
    }
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
