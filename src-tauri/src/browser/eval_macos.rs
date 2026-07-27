//! Isolated-world JavaScript evaluation for the browser driver (macOS).
//!
//! Split from `surface_macos.rs` — which owns view lifecycle, geometry and
//! navigation — because evaluation is its own concern and the file outgrew the
//! 300-line gate once the submit/await split landed.
//!
//! **The submit/await split is the WI-2 race fix, not a refactor.** Enqueuing a
//! script (`callAsyncJavaScript`) returns immediately and is safe to do while the
//! registry guard is held; waiting for the result PUMPS the main run loop, and
//! WebKit callbacks re-enter on that thread and take the same lock. So the two
//! halves must be separable: `authorize::submit_if_fresh` holds the guard across
//! the check and the enqueue — closing the window where another thread could
//! navigate or destroy the tab — and the caller awaits unlocked.
//!
//! @coordinates-with browser/authorize.rs — the guarded submit
//! @coordinates-with browser/no_bridge.rs — the R3 assertion this evaluates

use super::view::js_result_to_string;
use super::{driver_loop::pump_until, on_main, WEBVIEWS};
use crate::browser::surface::BrowserSurface;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSError, NSRunLoop, NSString};
use objc2_web_kit::{WKContentWorld, WKWebView};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Enqueue a script and return the sink its completion handler will fill.
///
/// Deliberately does NOT pump: this is the half that is safe to run while the
/// registry guard is held (see `authorize::submit_if_fresh`). Pumping under that
/// lock would deadlock against a re-entrant WebKit callback.
fn submit_js(
    webview: &WKWebView,
    script: &str,
    world: &WKContentWorld,
) -> Rc<RefCell<Option<String>>> {
    let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let body = NSString::from_str(script);
    let sink = out.clone();
    let handler = block2::RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
        *sink.borrow_mut() = Some(js_result_to_string(value));
    });
    unsafe {
        webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &body,
            None,
            None,
            world,
            Some(&handler),
        );
    }
    out
}

/// Pump the run loop until the sink fills, or the cap elapses. Runs UNLOCKED.
fn await_js(run_loop: &NSRunLoop, out: Rc<RefCell<Option<String>>>) -> String {
    // Real elapsed time, not a count of intended sleeps (see driver_loop).
    pump_until(run_loop, Duration::from_secs(5), 0.05, || {
        out.borrow().is_some()
    });
    let result = out.borrow_mut().take();
    result.unwrap_or_else(|| "<timeout>".into())
}

pub(super) fn eval_js(
    webview: &WKWebView,
    script: &str,
    world: &WKContentWorld,
    run_loop: &NSRunLoop,
) -> String {
    let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let body = NSString::from_str(script);
    let sink = out.clone();
    let handler = block2::RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
        *sink.borrow_mut() = Some(js_result_to_string(value));
    });
    unsafe {
        webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &body,
            None,
            None,
            world,
            Some(&handler),
        );
    }
    // Real elapsed time, not a count of intended sleeps (see driver_loop).
    pump_until(run_loop, Duration::from_secs(5), 0.05, || {
        out.borrow().is_some()
    });
    let result = out.borrow_mut().take();
    result.unwrap_or_else(|| "<timeout>".into())
}

/// Evaluate `script` in the driver's isolated world, re-verifying `expected_generation`
/// **inside the main-thread closure** (WI-2.1/2.2).
///
/// The command thread already authorized and re-checked freshness, but there is a real
/// window between that check and this closure actually running: `run_on_main_thread`
/// enqueues, and the main thread may service a navigation first. An eval side effect
/// cannot be undone by a post-check, so the last word has to be here.
///
/// SCOPE OF THE GUARANTEE — stated precisely, because an earlier version of this
/// comment overclaimed. No main-thread work can interleave between the check and
/// `callAsyncJavaScript`: both run in one main-thread turn. What CAN still interleave
/// is another **thread** — a Tauri command thread marking the tab destroyed, beginning
/// a navigation, or bumping the policy epoch in that same window. So this narrows the
/// race from "any main-thread event" to "a cross-thread state change inside one
/// synchronous turn", which is far tighter than the command-thread check alone, but it
/// is not zero. Closing it entirely means holding the registry guard across
/// `callAsyncJavaScript` and releasing it before `pump_until` — deliberately not done
/// here, because it puts a lock on the main thread's path with WebKit re-entrancy
/// nearby, and that trade needs its own review rather than being smuggled into this fix.
///
/// **Lock discipline (WI-2.2): no lock may be held across run-loop pumping.**
/// `eval_js` pumps the main run loop while it waits for `callAsyncJavaScript`'s
/// completion handler, and WebKit callbacks re-enter on this same thread and take the
/// registry lock themselves (the nav delegate does exactly that). Holding the registry
/// — or any `BrowserSurface` guard — across `eval_js` would deadlock immediately.
/// `command_still_fresh` acquires and releases internally, so the guards are all gone
/// before the dispatch below; keep it that way.
pub fn eval(
    app: &AppHandle,
    tab_id: String,
    script: String,
    expected_generation: u64,
) -> Result<String, String> {
    let app_for_closure = app.clone();
    on_main(app, move |mtm| {
        // Re-verify against live state, not a snapshot: a snapshot taken on the command
        // thread is precisely what could not detect a navigation that landed since.
        let state = app_for_closure
            .try_state::<BrowserSurface>()
            .ok_or_else(|| "browser state unavailable".to_string())?;
        // The verify-then-dispatch ordering lives in `authorize::dispatch_if_fresh`
        // so it is unit-testable; this closure supplies only the native call. When
        // it was inline here, deleting the check left every test green.
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        let run_loop = NSRunLoop::mainRunLoop();
        let world =
            unsafe { WKContentWorld::worldWithName(&NSString::from_str("vmark-agent"), mtm) };
        // Check + enqueue happen together under the registry guard, so no other
        // thread can navigate or destroy the tab in between; the pump then runs
        // unlocked, because a re-entrant WebKit callback takes that same lock.
        let sink = crate::browser::authorize::submit_if_fresh(
            &state,
            &tab_id,
            expected_generation,
            || submit_js(&webview, &script, &world),
        )?;
        Ok(await_js(&run_loop, sink))
    })
}
