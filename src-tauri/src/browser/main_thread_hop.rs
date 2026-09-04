//! The main-thread hop's cancellation protocol (audit 20260903 round 3, #32).
//!
//! `surface_macos::on_main` queues a closure on the AppKit main thread and waits
//! for its result with a deadline. A deadline that fires does NOT dequeue the
//! closure: it used to run anyway, after the caller had rolled back and reported
//! failure — a create, navigate or destroy landing on native state nobody expected
//! it to touch. Round 1 added an "abandoned" flag the closure read once before
//! running, which left two gaps: the waiter could time out in the instant AFTER
//! that read (the closure then ran unobserved, exactly as before), and a closure
//! already mutating cannot be stopped at all — yet the caller was told "timed out"
//! as though nothing had happened.
//!
//! Both close with ONE compare-exchange on a tri-state, `Pending → Running |
//! Abandoned`. The closure claims `Running` before it touches anything; the waiter
//! claims `Abandoned` when the deadline fires. Exactly one claim wins. If the
//! waiter wins, the closure sees `Abandoned` and returns without running — nothing
//! mutates after the caller was told nothing would. If the closure wins, the waiter
//! LOST: the work is in progress and cannot be undone, so it waits for the
//! definitive result instead of returning a deadline error that would be a lie
//! about state. Every main-thread body is itself bounded (the `pump_until` caps),
//! so that wait ends.
//!
//! Pure std — no AppKit — so the race is exercised with plain threads in
//! `main_thread_hop.test.rs`; `on_main` supplies `run_on_main_thread` as the
//! scheduler.
//!
//! @coordinates-with browser/surface_macos.rs — `on_main`, the production caller
//! @coordinates-with browser/native_failure.rs — the `MAIN_THREAD_TIMEOUT` class

use crate::browser::native_failure::NativeSurfaceError;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

/// Queued; nobody has claimed it.
const PENDING: u8 = 0;
/// The closure claimed it: the body is running (or ran) and its result is coming.
const RUNNING: u8 = 1;
/// The waiter claimed it: the deadline fired first, and the body must not run.
const ABANDONED: u8 = 2;

/// The shared tri-state. One compare-exchange per side; whoever moves it off
/// `Pending` decides, and nothing moves it twice.
pub struct HopState(AtomicU8);

impl Default for HopState {
    fn default() -> Self {
        Self::new()
    }
}

impl HopState {
    pub fn new() -> Self {
        Self(AtomicU8::new(PENDING))
    }

    /// The closure's claim, made before the body runs. `true`: run it. `false`: the
    /// waiter gave up first — do nothing.
    pub fn claim_running(&self) -> bool {
        self.0
            .compare_exchange(PENDING, RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// The waiter's claim at the deadline. `true`: the body will never run. `false`:
    /// it already started, and its result must be awaited.
    pub fn claim_abandoned(&self) -> bool {
        self.0
            .compare_exchange(PENDING, ABANDONED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

/// Hand `job` to `schedule` (the main-thread executor) and wait up to `deadline`
/// for its result, under the protocol above.
///
/// `schedule` failing is reported as its own error; a deadline the body never
/// started before is the tagged `MAIN_THREAD_TIMEOUT`; a body that started is
/// awaited to its result; a body that ended without one (it panicked, or the
/// executor dropped it unrun) is an untagged error, never a hang.
pub fn hop<T, F, S>(schedule: S, deadline: Duration, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
    S: FnOnce(Box<dyn FnOnce() + Send + 'static>) -> Result<(), String>,
{
    let (tx, rx) = mpsc::channel();
    let state = Arc::new(HopState::new());
    let claim = Arc::clone(&state);
    schedule(Box::new(move || {
        if !claim.claim_running() {
            return;
        }
        let _ = tx.send(job());
    }))?;
    match rx.recv_timeout(deadline) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) if state.claim_abandoned() => {
            Err(NativeSurfaceError::MainThreadTimeout.tagged("main-thread op timed out"))
        }
        // Lost the race: the body is running and cannot be stopped. Its verdict is
        // the only truthful answer, so wait for it.
        Err(RecvTimeoutError::Timeout) => rx.recv().unwrap_or_else(|_| Err(no_result())),
        Err(RecvTimeoutError::Disconnected) => Err(no_result()),
    }
}

/// The sender is gone with nothing sent: the body panicked, or the executor dropped
/// the closure without running it.
fn no_result() -> String {
    "main-thread op ended without a result".to_string()
}

#[cfg(test)]
#[path = "main_thread_hop.test.rs"]
mod tests;
