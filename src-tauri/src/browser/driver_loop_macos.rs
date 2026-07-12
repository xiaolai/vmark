//! Run-loop pump helpers for the macOS browser surface (WI-1.2). Split from
//! surface_macos.rs to keep it under the file-size limit; a `#[path]` submodule
//! of the `imp` module, so these are `pub(super)` for the surface to call.

use objc2_foundation::{NSDate, NSRunLoop};
use objc2_web_kit::WKWebView;

/// Pump the main run loop for `secs` so async WebKit callbacks fire while a
/// synchronous command awaits them on the main thread.
pub(super) fn pump(run_loop: &NSRunLoop, secs: f64) {
    let until = NSDate::dateWithTimeIntervalSinceNow(secs);
    run_loop.runUntilDate(&until);
}

/// Drive a navigation to first paint by pumping the run loop until the webview
/// stops loading (capped). Because `pump` explicitly cycles the loop, this
/// completes the load even when the app is App-Nap-throttled (window unfocused) —
/// the idle loop alone would stall it. Returns once the initial load settles or
/// `MAX` elapses.
pub(super) fn drive_load(webview: &WKWebView, run_loop: &NSRunLoop) {
    const MAX: f64 = 8.0; // hard cap
    const FLOOR: f64 = 2.0; // pump at least this if a load never registers
    const SETTLE: f64 = 0.4; // keep cycling after finish so the first paint lands
    let mut waited = 0.0;
    let mut seen_loading = false; // `isLoading` is false at t=0 before the nav commits
    let mut finished_at: Option<f64> = None;
    loop {
        pump(run_loop, 0.1);
        waited += 0.1;
        if waited >= MAX {
            break;
        }
        let loading = unsafe { webview.isLoading() };
        if loading {
            seen_loading = true;
            finished_at = None;
        } else if seen_loading && finished_at.is_none() {
            finished_at = Some(waited);
        }
        // Load started, then finished, then settled → done.
        if finished_at.is_some_and(|d| waited - d >= SETTLE) {
            break;
        }
        // A load never registered at all → don't wait past the floor.
        if !seen_loading && waited >= FLOOR {
            break;
        }
    }
}
