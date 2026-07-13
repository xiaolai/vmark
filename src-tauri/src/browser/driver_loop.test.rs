//! Unit tests for the navigation-drive state machine (WI-1.2).
//!
//! `drive_load` blocks the **main thread** while it pumps the run loop, so its
//! stopping rules are the difference between a snappy tab and a frozen app. The
//! rules are pure — "given how long we have waited and whether the webview says
//! it is loading, keep pumping?" — so they are tested here without WebKit; the
//! only thing left in the objc2 layer is reading `isLoading` and calling `pump`.

use super::*;

const MS: fn(u64) -> Duration = Duration::from_millis;

#[test]
fn a_load_that_starts_finishes_and_settles_is_done() {
    let mut p = LoadProgress::new();
    assert!(!p.observe(MS(100), true)); // loading
    assert!(!p.observe(MS(200), true));
    assert!(!p.observe(MS(300), false)); // finished at 300ms — now settle
    assert!(!p.observe(MS(500), false)); // 200ms of settle: not yet
    assert!(p.observe(MS(700), false)); // 400ms of settle → first paint landed
}

#[test]
fn a_load_that_never_registers_stops_at_the_floor_and_not_before() {
    // `isLoading` is false at t=0 before the navigation commits, so an immediate
    // "not loading" must NOT be read as "finished" — that would return before the
    // page ever painted. It waits out the floor instead.
    let mut p = LoadProgress::new();
    assert!(!p.observe(MS(100), false));
    assert!(!p.observe(MS(1_900), false));
    assert!(p.observe(MS(2_000), false)); // floor reached → stop waiting
}

#[test]
fn a_page_that_loads_forever_is_capped() {
    let mut p = LoadProgress::new();
    assert!(!p.observe(MS(3_000), true));
    assert!(!p.observe(MS(7_900), true)); // still streaming — keep pumping
    assert!(p.observe(MS(8_000), true)); // hard cap: never block the main thread past this
}

#[test]
fn a_redirect_restarts_the_settle_window() {
    let mut p = LoadProgress::new();
    assert!(!p.observe(MS(100), true)); // first load
    assert!(!p.observe(MS(200), false)); // finished…
    assert!(!p.observe(MS(300), true)); // …no: a redirect started a new load
    assert!(!p.observe(MS(400), false)); // finished again — settle restarts here
    assert!(!p.observe(MS(700), false)); // 300ms since THIS finish: not yet
    assert!(p.observe(MS(800), false)); // 400ms → done
}

#[test]
fn the_floor_does_not_cut_off_a_load_that_is_still_running() {
    // The floor only applies while no load has EVER been seen; a slow load that is
    // still streaming at the floor must keep going, up to the hard cap.
    let mut p = LoadProgress::new();
    assert!(!p.observe(MS(1_000), true));
    assert!(!p.observe(MS(2_500), true)); // past the floor, still loading → continue
    assert!(!p.observe(MS(2_600), false));
    assert!(p.observe(MS(3_000), false)); // settled
}
