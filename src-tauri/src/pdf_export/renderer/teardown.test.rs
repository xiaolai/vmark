// #224, #227 — the close a timeout runs: at most once, never after the
// platform settled, and not at all where no window was built.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::*;

fn counted() -> (Teardown, Arc<AtomicUsize>) {
    let closes = Arc::new(AtomicUsize::new(0));
    let teardown = Teardown::default();
    let seen = closes.clone();
    teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    (teardown, closes)
}

#[test]
fn an_armed_close_runs_exactly_once() {
    let (teardown, closes) = counted();
    teardown.run();
    teardown.run();
    assert_eq!(closes.load(Ordering::SeqCst), 1, "one window, one close");
}

#[test]
fn a_disarmed_close_never_runs() {
    // The platform settled and closed — or kept — its window itself.
    let (teardown, closes) = counted();
    teardown.disarm();
    teardown.run();
    assert_eq!(closes.load(Ordering::SeqCst), 0);
}

#[test]
fn running_and_disarming_an_unarmed_teardown_is_a_quiet_no_op() {
    // macOS arms nothing: its body drops its own window on return.
    let teardown = Teardown::default();
    teardown.run();
    teardown.disarm();
}

// #447 — the caller's timeout can fire before the main thread has finished
// building the window. `run` used to find nothing and forget the request, and
// the window armed a moment later then lived for the life of the app.
#[test]
fn a_run_that_arrives_before_the_window_closes_it_as_soon_as_it_is_armed() {
    let teardown = Teardown::default();
    teardown.run();

    let closes = Arc::new(AtomicUsize::new(0));
    let seen = closes.clone();
    teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    assert_eq!(
        closes.load(Ordering::SeqCst),
        1,
        "the remembered run closes the window the arm just handed over"
    );

    teardown.run();
    assert_eq!(closes.load(Ordering::SeqCst), 1, "and only once");
}

// A settle after that timeout must not erase the memory: the window armed
// afterwards still has nobody else to close it.
#[test]
fn disarming_after_a_remembered_run_does_not_forget_it() {
    let teardown = Teardown::default();
    teardown.run();
    teardown.disarm();

    let closes = Arc::new(AtomicUsize::new(0));
    let seen = closes.clone();
    teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

#[test]
fn the_close_can_be_run_from_another_thread() {
    // `wait.rs` runs it from the async caller, not the UI thread that armed
    // it; Tauri's `WebviewWindow::close` dispatches to the event loop itself.
    let (teardown, closes) = counted();
    let teardown = Arc::new(teardown);
    let runner = {
        let teardown = teardown.clone();
        std::thread::spawn(move || teardown.run())
    };
    runner.join().expect("runner");
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

// #448 — one sink has one window, and a second `arm` is a bug. It used to be
// a `debug_assert!` alone, so the SHIPPED build quietly dropped the first
// window's close and leaked it. Whatever else a broken invariant does, it must
// not leak the thing this type exists to close.
#[test]
fn a_second_arm_closes_the_window_the_first_one_named() {
    let first = Arc::new(AtomicUsize::new(0));
    let second = Arc::new(AtomicUsize::new(0));
    let teardown = Teardown::default();

    let seen = first.clone();
    teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    let seen = second.clone();
    teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });

    assert_eq!(
        first.load(Ordering::SeqCst),
        1,
        "the displaced window comes down instead of leaking"
    );
    assert_eq!(
        second.load(Ordering::SeqCst),
        0,
        "the new one is still armed"
    );

    teardown.run();
    assert_eq!(second.load(Ordering::SeqCst), 1, "and runs on the timeout");
    assert_eq!(
        first.load(Ordering::SeqCst),
        1,
        "the first ran once, not twice"
    );
}
