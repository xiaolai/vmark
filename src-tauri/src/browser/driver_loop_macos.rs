//! Run-loop pump helpers for the macOS browser surface (WI-1.2). Split from
//! surface_macos.rs to keep it under the file-size limit; a `#[path]` submodule
//! of the `imp` module, so these are `pub(super)` for the surface to call.
//!
//! Every wait here is measured with a **monotonic** `Instant`, never by adding up
//! the intervals we *asked* `runUntilDate` for: it returns as soon as it has
//! processed input — and a single callback it dispatches can itself run for a long
//! time — so counted intervals bear no relation to the wall clock they claim to
//! cap. These caps bound how long the **main thread** is blocked, so they have to
//! be real.

use objc2_foundation::{NSDate, NSRunLoop};
use objc2_web_kit::WKWebView;
use std::time::{Duration, Instant};

/// Pump the main run loop for `secs` so async WebKit callbacks fire while a
/// synchronous command awaits them on the main thread.
pub(super) fn pump(run_loop: &NSRunLoop, secs: f64) {
    let until = NSDate::dateWithTimeIntervalSinceNow(secs);
    run_loop.runUntilDate(&until);
}

/// Pump the run loop in `interval`-second slices until `done()` reports true or
/// `timeout` of real time elapses. Returns whether `done()` was satisfied.
///
/// The one place a synchronous command waits on an asynchronous WebKit callback:
/// used both for driving a navigation and for awaiting a `callAsyncJavaScript`
/// result, which previously each hand-rolled the same loop with their own
/// synthetic clock.
pub(super) fn pump_until(
    run_loop: &NSRunLoop,
    timeout: Duration,
    interval: f64,
    mut done: impl FnMut() -> bool,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if done() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        pump(run_loop, interval);
    }
}

/// The pure decision half of `drive_load`: given how long we have really waited
/// and whether the webview says it is loading, should we stop pumping?
///
/// Kept free of WebKit so every stopping rule (settle, floor, hard cap, redirect)
/// is unit-tested — this loop blocks the main thread, so a rule that is subtly
/// wrong is a frozen app, not a slow one.
pub(super) struct LoadProgress {
    /// `isLoading` is false at t=0 — before the navigation commits — so "not
    /// loading" only means "finished" once a load has actually been observed.
    seen_loading: bool,
    /// When the load stopped, if it has. Reset by a redirect starting a new one.
    finished_at: Option<Duration>,
}

impl LoadProgress {
    /// Hard cap on blocking the main thread, however slow the page is.
    const MAX: Duration = Duration::from_millis(8_000);
    /// If a load never registers at all, stop waiting here.
    const FLOOR: Duration = Duration::from_millis(2_000);
    /// Keep cycling this long after the load finishes so the first paint lands.
    const SETTLE: Duration = Duration::from_millis(400);

    pub(super) fn new() -> Self {
        Self {
            seen_loading: false,
            finished_at: None,
        }
    }

    /// Fold in one observation. `true` = stop driving this load.
    pub(super) fn observe(&mut self, elapsed: Duration, loading: bool) -> bool {
        if elapsed >= Self::MAX {
            return true;
        }
        if loading {
            self.seen_loading = true;
            self.finished_at = None; // a redirect started a new load
        } else if self.seen_loading && self.finished_at.is_none() {
            self.finished_at = Some(elapsed);
        }
        // Started, then finished, then settled → the first paint has landed.
        if self
            .finished_at
            .is_some_and(|at| elapsed.saturating_sub(at) >= Self::SETTLE)
        {
            return true;
        }
        // No load ever registered → don't wait past the floor.
        !self.seen_loading && elapsed >= Self::FLOOR
    }
}

/// Drive a navigation to first paint by pumping the run loop until the webview
/// settles (see `LoadProgress` for the exact rules). Because `pump` explicitly
/// cycles the loop, this completes the load even when the app is App-Nap-throttled
/// (window unfocused) — the idle loop alone would stall it.
pub(super) fn drive_load(webview: &WKWebView, run_loop: &NSRunLoop) {
    let mut progress = LoadProgress::new();
    let start = Instant::now();
    loop {
        pump(run_loop, 0.1);
        let loading = unsafe { webview.isLoading() };
        if progress.observe(start.elapsed(), loading) {
            return;
        }
    }
}

#[cfg(test)]
#[path = "driver_loop.test.rs"]
mod tests;
