// WI-19 — cancel lifecycle and the concurrency flag, as state behavior.
//
//! Moved here from `commands.test.rs` (audit 20260803 §1/§3): the cancel
//! decision and the flag release are properties of `WorkflowRunnerState`, not
//! of the Tauri command that calls them, and `commands.rs` sits on its
//! file-size cap.
//!
//! The two interleaving tests use the `current_execution` mutex ITSELF as the
//! barrier. That is not a trick — it is the exact instant the race lives at:
//! whichever of "publish `running = false`" and "clear the execution id"
//! happens outside the lock is the one a concurrent starter can observe.

use super::*;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

fn state_with(running: bool, exec: Option<&str>) -> WorkflowRunnerState {
    WorkflowRunnerState {
        running: AtomicBool::new(running),
        current_execution: Arc::new(Mutex::new(exec.map(str::to_string))),
        ..WorkflowRunnerState::default()
    }
}

// -- decide_cancel ----------------------------------------------------------

#[test]
fn cancel_fires_when_id_matches_running_execution() {
    assert_eq!(
        decide_cancel(Some("exec-a"), "exec-a"),
        CancelDecision::Cancel
    );
}

#[test]
fn cancel_rejected_when_nothing_is_running() {
    // A cancel arriving while idle must not arm the cancel flag.
    assert_eq!(decide_cancel(None, "exec-a"), CancelDecision::NotRunning);
}

#[test]
fn cancel_rejected_when_a_different_execution_is_running() {
    // The TOCTOU case: exec-a finished, exec-b started, late cancel(exec-a)
    // arrives — it must NOT cancel exec-b.
    assert_eq!(
        decide_cancel(Some("exec-b"), "exec-a"),
        CancelDecision::NotRunning
    );
}

// -- request_cancel ---------------------------------------------------------

#[test]
fn request_cancel_arms_the_flag_only_for_the_running_execution() {
    let st = state_with(true, Some("exec-a"));
    assert_eq!(st.request_cancel("exec-b"), CancelDecision::NotRunning);
    assert!(
        !st.cancel_requested.load(Ordering::SeqCst),
        "a stale id must not arm the runner's cancel flag"
    );

    assert_eq!(st.request_cancel("exec-a"), CancelDecision::Cancel);
    assert!(st.cancel_requested.load(Ordering::SeqCst));
}

#[test]
fn request_cancel_works_while_the_engine_flag_is_off() {
    // Audit 20260803 §3: turning `advanced.workflowEngine` off mid-run must not
    // make the running workflow unstoppable. The state carries no gate at all —
    // the gate lives on `run_workflow` alone.
    let st = state_with(true, Some("exec-a"));
    st.set_engine_enabled(false);
    assert_eq!(st.request_cancel("exec-a"), CancelDecision::Cancel);
    assert!(st.cancel_requested.load(Ordering::SeqCst));
}

#[test]
fn disabling_the_engine_asks_a_running_workflow_to_stop() {
    // The policy setter's false transition (audit 20260803 §3): the user who
    // just switched the feature off should not have to also find the cancel
    // button.
    let st = state_with(true, Some("exec-a"));
    assert!(st.request_cancel_if_running());
    assert!(st.cancel_requested.load(Ordering::SeqCst));
}

#[test]
fn disabling_the_engine_while_idle_arms_nothing() {
    // Arming the flag with nothing running would be latched state that the
    // NEXT run has to remember to reset.
    let st = state_with(false, None);
    assert!(!st.request_cancel_if_running());
    assert!(!st.cancel_requested.load(Ordering::SeqCst));
}

// -- clear_running ----------------------------------------------------------

#[test]
fn clear_running_releases_flag_and_execution_id() {
    // Mirrors what RunningGuard::drop does on every exit path: the running
    // execution id and the concurrency flag are both released, so the next
    // run starts clean and a stale cancel can no longer match.
    let st = state_with(true, Some("exec-a"));
    st.clear_running();
    assert!(!st.running.load(Ordering::SeqCst));
    assert!(st.current_execution.lock().unwrap().is_none());
}

#[test]
fn cancel_no_longer_matches_after_clear() {
    // End-to-end of the cancel state transition: publish id → clear (as on
    // drop / pre-spawn failure) → a cancel for that id is now rejected.
    let st = state_with(true, Some("exec-a"));
    let published = st.current_execution.lock().unwrap().clone();
    assert_eq!(
        decide_cancel(published.as_deref(), "exec-a"),
        CancelDecision::Cancel
    );
    st.clear_running();
    let after = st.current_execution.lock().unwrap().clone();
    assert_eq!(
        decide_cancel(after.as_deref(), "exec-a"),
        CancelDecision::NotRunning
    );
}

// -- The ordering inside clear_running (audit 20260803 §1) -------------------

/// Park a `clear_running` call on the `current_execution` mutex, which the
/// caller holds. Deterministic (audit 20260803 round 2 — the round-1 version
/// slept 50 ms after a barrier, so a descheduled worker could false-pass an
/// unfixed implementation): the worker raises `entered` immediately before
/// calling `clear_running`, and the caller spin-waits on that flag — a worker
/// that never runs hangs the test loudly instead of passing silently. The
/// flag is followed by explicit scheduling slices, not wall time: an unfixed
/// implementation's FIRST statement is `running.store(false)`, which needs
/// exactly one slice to execute and flip the callers' `running`/CAS probes.
fn park_clear_running(state: &Arc<WorkflowRunnerState>) -> std::thread::JoinHandle<()> {
    let entered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker = std::thread::spawn({
        let state = Arc::clone(state);
        let entered = Arc::clone(&entered);
        move || {
            entered.store(true, Ordering::SeqCst);
            state.clear_running();
        }
    });
    while !entered.load(Ordering::SeqCst) {
        std::thread::yield_now();
    }
    for _ in 0..1_000 {
        std::thread::yield_now();
    }
    worker
}

#[test]
fn the_concurrency_flag_is_not_released_before_the_execution_id_is_cleared() {
    // THE finding: publishing `running = false` first opens a window in which a
    // new workflow wins the CAS and publishes ITS id — which the old guard's
    // second statement then erases, leaving the new run uncancellable.
    let state = Arc::new(state_with(true, Some("exec-a")));
    let held = state
        .current_execution
        .lock()
        .expect("uncontended in the test thread");

    let worker = park_clear_running(&state);

    assert!(
        state.running.load(Ordering::SeqCst),
        "clear_running published running=false while the old execution id was \
         still installed — a new run can start into a guard that will erase it"
    );

    drop(held);
    worker.join().expect("clear_running must not panic");
    assert!(!state.running.load(Ordering::SeqCst));
    assert!(state.current_execution.lock().unwrap().is_none());
}

#[test]
fn a_new_run_cannot_win_the_cas_until_the_old_execution_id_is_gone() {
    // The same ordering, stated as the invariant `run_workflow` depends on:
    // winning the CAS must imply the previous execution id has already been
    // cleared, so the CAS winner's own `current_execution` write is the last
    // one and survives.
    let state = Arc::new(state_with(true, Some("exec-a")));
    let held = state
        .current_execution
        .lock()
        .expect("uncontended in the test thread");

    let worker = park_clear_running(&state);

    assert!(
        state
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err(),
        "a new run won the concurrency CAS while exec-a's id was still published"
    );

    drop(held);
    worker.join().expect("clear_running must not panic");
    assert!(
        state
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok(),
        "once the id is cleared the flag must be free again"
    );
}
