//! Audit 20260903 round 3, #32 — a timed-out main-thread closure either never runs
//! or is awaited; it is never both "timed out" and running.

use super::*;
use crate::browser::native_failure::NativeSurfaceError;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::AtomicBool;
use std::thread;
use std::time::Instant;

type Job = Box<dyn FnOnce() + Send + 'static>;

/// A "main thread" that is busy for `delay` before it gets to the job. Hands back the
/// worker's handle so a test can join it and inspect what ran.
fn busy_main_thread(
    delay: Duration,
) -> (
    impl FnOnce(Job) -> Result<(), NativeSurfaceError>,
    mpsc::Receiver<thread::JoinHandle<()>>,
) {
    let (handles_tx, handles_rx) = mpsc::channel();
    let schedule = move |job: Job| {
        let worker = thread::spawn(move || {
            thread::sleep(delay);
            // A panicking body must not take the test harness down with it; the
            // protocol's answer to it is what is under test.
            let _ = catch_unwind(AssertUnwindSafe(job));
        });
        let _ = handles_tx.send(worker);
        Ok(())
    };
    (schedule, handles_rx)
}

#[test]
fn a_result_that_arrives_in_time_is_returned() {
    let (schedule, _workers) = busy_main_thread(Duration::ZERO);
    let out: Result<u32, NativeSurfaceError> = hop(schedule, Duration::from_secs(5), || Ok(42));
    assert_eq!(out, Ok(42));
}

#[test]
fn a_body_the_deadline_beat_never_runs() {
    let ran = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&ran);
    let (schedule, workers) = busy_main_thread(Duration::from_millis(800));
    let out: Result<(), NativeSurfaceError> = hop(schedule, Duration::from_millis(50), move || {
        observed.store(true, Ordering::SeqCst);
        Ok(())
    });
    let err = out.expect_err("the deadline fired first");
    assert!(
        matches!(err, NativeSurfaceError::MainThreadTimeout(_)),
        "{err}"
    );
    // The main thread eventually gets to the closure — and must find it abandoned.
    workers.recv().expect("scheduled").join().expect("worker");
    assert!(
        !ran.load(Ordering::SeqCst),
        "the body ran after the caller was told it timed out"
    );
}

#[test]
fn a_body_already_running_at_the_deadline_is_awaited_not_abandoned() {
    // The scheduler returns only once the body has STARTED (so its `Running` claim is
    // in), and the body then outlives the deadline. The waiter must lose the race and
    // wait for the real verdict rather than report a timeout for work that lands.
    let (started_tx, started_rx) = mpsc::channel();
    let schedule = move |job: Job| {
        thread::spawn(job);
        started_rx
            .recv()
            .map_err(|_| NativeSurfaceError::Unclassified("body never started".into()))
    };
    let began = Instant::now();
    let body_duration = Duration::from_millis(300);
    let out: Result<&'static str, NativeSurfaceError> =
        hop(schedule, Duration::from_millis(50), move || {
            let _ = started_tx.send(());
            thread::sleep(body_duration);
            Ok("landed")
        });
    assert_eq!(out, Ok("landed"));
    assert!(
        began.elapsed() >= body_duration,
        "returned after {:?} — before the body could have finished",
        began.elapsed()
    );
}

#[test]
fn a_scheduler_that_refuses_is_reported_without_waiting() {
    let began = Instant::now();
    let refused = NativeSurfaceError::Unclassified("run_on_main_thread: event loop closed".into());
    let out: Result<(), NativeSurfaceError> = hop(
        |_job: Job| Err(refused.clone()),
        Duration::from_secs(5),
        || Ok(()),
    );
    assert_eq!(out, Err(refused));
    assert!(began.elapsed() < Duration::from_secs(1));
}

#[test]
fn a_body_that_panics_after_claiming_is_an_error_not_a_hang() {
    let (schedule, workers) = busy_main_thread(Duration::ZERO);
    let out: Result<(), NativeSurfaceError> = hop(schedule, Duration::from_secs(5), || {
        panic!("body exploded");
    });
    assert!(
        out.as_ref()
            .is_err_and(|e| e.detail().contains("without a result")),
        "{out:?}"
    );
    workers.recv().expect("scheduled").join().expect("worker");
}

#[test]
fn a_closure_the_executor_drops_unrun_is_an_error_not_a_hang() {
    // The executor accepted the job, then dropped it (an event loop shutting down).
    let out: Result<(), NativeSurfaceError> = hop(
        |job: Job| {
            drop(job);
            Ok(())
        },
        Duration::from_secs(5),
        || Ok(()),
    );
    assert!(
        out.as_ref()
            .is_err_and(|e| e.detail().contains("without a result")),
        "{out:?}"
    );
}

#[test]
fn exactly_one_side_claims_the_hop() {
    let state = HopState::new();
    assert!(state.claim_running(), "first claim wins");
    assert!(
        !state.claim_abandoned(),
        "the waiter cannot abandon a running body"
    );
    assert!(!state.claim_running(), "a claim is made once");

    let state = HopState::default();
    assert!(state.claim_abandoned(), "first claim wins");
    assert!(!state.claim_running(), "an abandoned body must not run");
    assert!(!state.claim_abandoned(), "a claim is made once");
}
