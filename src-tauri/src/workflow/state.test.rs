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

// -- #260 / #274: gate + claim against disable + cancel, under one lock --------

/// Park a call on the admission lock the caller holds, then give it explicit
/// scheduling slices (the same discipline as `park_clear_running`).
fn park_on_admission<F>(state: &Arc<WorkflowRunnerState>, call: F) -> std::thread::JoinHandle<()>
where
    F: FnOnce(&WorkflowRunnerState) + Send + 'static,
{
    let entered = Arc::new(AtomicBool::new(false));
    let worker = std::thread::spawn({
        let state = Arc::clone(state);
        let entered = Arc::clone(&entered);
        move || {
            entered.store(true, Ordering::SeqCst);
            call(&state);
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
fn disabling_the_engine_waits_for_a_start_that_holds_the_admission_lock() {
    // The race: a start reads "enabled", the policy flips the flag and finds
    // nothing running, the start then claims `running` — a workflow starting
    // disabled with no cancel aimed at it. The policy must block until the
    // start's claim is in, and then see it.
    let state = Arc::new(state_with(false, None));
    state.set_engine_enabled(true);
    let held = state.admission_lock();

    let worker = park_on_admission(&state, |s| {
        s.apply_engine_policy(false);
    });
    assert!(
        state.engine_enabled(),
        "the policy wrote its flag while a start held the admission lock"
    );

    // The start completes its claim under the lock it holds…
    let admission = state
        .claim_and_publish("exec-policy")
        .expect("claimed")
        .expect("a fresh id");
    drop(held);
    worker.join().expect("policy must not panic");

    // …and the disable that followed found it and cancelled it.
    assert!(!state.engine_enabled());
    assert!(
        state.cancel_requested.load(Ordering::SeqCst),
        "the run that was admitted just before the disable is cancelled"
    );
    drop(admission);
}

#[test]
fn apply_engine_policy_reports_whether_a_run_was_asked_to_stop() {
    let idle = state_with(false, None);
    assert!(!idle.apply_engine_policy(false));
    assert!(!idle.cancel_requested.load(Ordering::SeqCst));
    assert!(!idle.engine_enabled());

    let busy = state_with(true, Some("exec-a"));
    assert!(busy.apply_engine_policy(false));
    assert!(busy.cancel_requested.load(Ordering::SeqCst));

    let on = state_with(true, Some("exec-a"));
    assert!(!on.apply_engine_policy(true), "enabling cancels nothing");
    assert!(on.engine_enabled());
}

// -- #273: match and arm under the execution lock --------------------------------

#[test]
fn request_cancel_cannot_arm_the_flag_while_the_next_run_holds_the_execution_lock() {
    // The race: a stale cancel reads `current == A`, A finishes, B claims and
    // resets the flag, and only THEN the stale store lands — cancelling B.
    // Holding the id lock across match + store closes it: a cancel either
    // completes before B's reset (and is reset) or reads B's id (and is
    // refused).
    let state = Arc::new(state_with(true, Some("exec-a")));
    let held = state
        .current_execution
        .lock()
        .expect("uncontended in the test thread");

    let worker = park_on_admission(&state, |s| {
        assert_eq!(s.request_cancel("exec-a"), CancelDecision::Cancel);
    });
    assert!(
        !state.cancel_requested.load(Ordering::SeqCst),
        "the cancel armed the flag without the execution lock"
    );
    drop(held);
    worker.join().expect("cancel must not panic");
    assert!(state.cancel_requested.load(Ordering::SeqCst));
}

#[test]
fn a_claim_resets_a_stale_cancel_and_a_refused_claim_touches_nothing() {
    let st = state_with(false, None);
    st.cancel_requested.store(true, Ordering::SeqCst);
    let admission = st
        .claim_and_publish("exec-a")
        .expect("idle: claimed")
        .expect("a fresh id");
    assert!(st.running.load(Ordering::SeqCst));
    assert!(!st.cancel_requested.load(Ordering::SeqCst));

    // A second claim while the first holds the flag is refused and leaves the
    // live run's cancel state alone.
    st.cancel_requested.store(true, Ordering::SeqCst);
    assert!(st.claim_and_publish("exec-b").is_none());
    assert!(st.cancel_requested.load(Ordering::SeqCst));
    drop(admission);
    assert!(
        !st.running.load(Ordering::SeqCst),
        "the guard released the flag"
    );
}

// -- #259 / #267: the admission guard ------------------------------------------

#[test]
fn a_committed_admission_leaves_the_flag_and_the_id_to_the_runner() {
    let st = state_with(false, None);
    let admission = st
        .claim_and_publish("exec-a")
        .expect("claimed")
        .expect("a fresh id");
    assert_eq!(
        st.request_cancel("exec-a"),
        CancelDecision::Cancel,
        "the id is matchable before the spawn — a cancel during the snapshot lands"
    );
    admission.commit();
    assert!(
        st.running.load(Ordering::SeqCst),
        "committed: still running"
    );
    assert_eq!(
        st.current_execution.lock().unwrap().as_deref(),
        Some("exec-a")
    );
    // What the runner's RunningGuard does at the end.
    st.clear_running();
    assert!(!st.running.load(Ordering::SeqCst));
}

#[test]
fn a_dropped_admission_clears_the_published_id_too() {
    let st = state_with(false, None);
    let admission = st
        .claim_and_publish("exec-a")
        .expect("claimed")
        .expect("a fresh id");
    drop(admission);
    assert!(!st.running.load(Ordering::SeqCst));
    assert!(
        st.current_execution.lock().unwrap().is_none(),
        "an early return must not leave a stale id behind"
    );
}

// -- #264: an execution id is used once ------------------------------------

#[test]
fn an_execution_id_a_recent_run_carried_is_refused_with_conflict() {
    // Idle: `claim_and_publish` claims the flag itself now, so the fixture
    // must not pre-hold it.
    let st = state_with(false, None);
    st.claim_and_publish("exec-a")
        .expect("claimed")
        .expect("fresh")
        .commit();
    st.clear_running();
    let err = st
        .claim_and_publish("exec-a")
        .expect("the flag is free, so the claim is won")
        .expect_err("reused");
    assert_eq!(err.code(), crate::command_error::ErrorCode::Conflict);
    assert!(
        st.current_execution.lock().unwrap().is_none(),
        "a refused id is not published"
    );
    assert!(
        !st.running.load(Ordering::SeqCst),
        "and the claim it took is released with the guard it dropped"
    );
    st.claim_and_publish("exec-b")
        .expect("claimed")
        .expect("a fresh id after the refusal");
}
