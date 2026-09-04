//! macOS native browser surface — the objc2 WKWebView implementation of the
//! WI-1.2 surface. Split from surface.rs (which keeps the cross-platform
//! struct + command-facing re-exports) to stay under the file-size limit.
//! Included via `#[path]` from surface.rs; `super::` refers to that module.

use crate::browser::eval_outcome::EvalError;
use crate::browser::main_thread_hop::hop;
use crate::browser::native_failure::NativeSurfaceError;
use crate::browser::surface::BrowserSurface;
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSRunLoop, NSURLRequest};
use objc2_web_kit::{WKContentWorld, WKWebView};
use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[path = "nav_delegate_macos.rs"]
mod nav_delegate;
use nav_delegate::NavDelegate;

#[path = "driver_loop_macos.rs"]
mod driver_loop;
use driver_loop::{drive_load, pump_until};

#[path = "dialogs_macos.rs"]
mod dialogs;

#[path = "surface_lifecycle_macos.rs"]
mod lifecycle;
pub use lifecycle::destroy;
use lifecycle::evict_existing;

#[path = "browser_store_macos.rs"]
mod browser_store;
#[path = "console_shim_macos.rs"]
mod console_shim;
#[path = "content_rules_macos.rs"]
mod content_rules;
#[path = "recorder_shim_macos.rs"]
mod recorder_shim;
#[path = "user_input_monitor_macos.rs"]
mod user_input_monitor;

#[path = "surface_create_macos.rs"]
mod creation;
#[path = "screenshot_macos.rs"]
pub mod screenshot;
#[path = "session_cookies_macos.rs"]
pub mod session_cookies;
pub use creation::{create, create_with_mode, forget_profile};

thread_local! {
    /// Main-thread-only live webviews, keyed by tab id.
    static WEBVIEWS: RefCell<HashMap<String, Retained<WKWebView>>> = RefCell::new(HashMap::new());
    /// Navigation delegates, kept alive here because `WKWebView` holds its
    /// `navigationDelegate` **weakly** — dropping the `Retained` would silently
    /// stop all lifecycle/crash callbacks. Cleared in `destroy`.
    static DELEGATES: RefCell<HashMap<String, Retained<NavDelegate>>> = RefCell::new(HashMap::new());
}

#[path = "user_input_resolve_macos.rs"]
mod user_input_resolve;
use user_input_resolve::{tab_id_at_window_point, tab_id_for_responder};

/// Run `f` on the main thread and return its result (20s cap). Every failure —
/// the body's, the hop's, the scheduler's — is a typed `NativeSurfaceError`
/// (round 4, #31); nothing on this path renders a `fail::` string.
///
/// **Already on the main thread → run inline.** `run_on_main_thread` always
/// ENQUEUES on the event loop, so a caller that is itself inside an event-loop
/// callback (the window-destroyed handler that tears down a closed window's
/// browser tabs, a menu handler) would block on a job that cannot start until it
/// returns — a 20 s stall, then an abandoned closure and a LEAKED native view.
/// Journey 37 (`browser-secondary-window-teardown`) caught exactly that: the
/// teardown logged its intent and the view stayed in the native map.
///
/// What happens when the cap fires is `main_thread_hop::hop`'s protocol: a closure
/// that has not started never runs (the caller rolled back and reported failure;
/// nothing may mutate native state after that), and a closure that HAS started is
/// awaited to its real result, because a body already touching AppKit cannot be
/// stopped and a "timed out" for work that lands would misstate the state.
fn on_main<T, F>(app: &AppHandle, f: F) -> Result<T, NativeSurfaceError>
where
    T: Send + 'static,
    F: FnOnce(MainThreadMarker) -> Result<T, NativeSurfaceError> + Send + 'static,
{
    if let Some(mtm) = MainThreadMarker::new() {
        return f(mtm);
    }
    hop(
        |job| {
            app.run_on_main_thread(job)
                .map_err(|e| NativeSurfaceError::Unclassified(format!("run_on_main_thread: {e}")))
        },
        Duration::from_secs(20),
        || match MainThreadMarker::new() {
            Some(mtm) => f(mtm),
            None => Err(NativeSurfaceError::Unclassified(
                "no MainThreadMarker".to_string(),
            )),
        },
    )
}

#[path = "eval_macos.rs"]
mod eval_impl;
pub use eval_impl::eval;
use eval_impl::eval_js;

#[cfg(debug_assertions)]
#[path = "debug_probe_macos.rs"]
mod debug_probe;
#[cfg(debug_assertions)]
pub use debug_probe::{debug_attached_webviews, debug_hit_test, debug_native_tab_ids};

#[path = "surface_view_macos.rs"]
pub(super) mod view;
use view::{content_view, frame_for_dom_rect, ns_url};

/// Release the sandbox profile after AI views are torn down or posture changes.
pub fn clear_ai_sandbox_store(app: &AppHandle) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        browser_store::clear();
        Ok(())
    })
}

/// The live webview for `tab_id`, or the `NoWebview` failure — the one producer
/// of that class, so every entry point reports a missing view the same way. Clones
/// the handle out of the map so no `RefCell` borrow is held while the run loop is
/// pumped (a pump can re-enter WEBVIEWS).
fn webview_for(tab_id: &str) -> Result<Retained<WKWebView>, NativeSurfaceError> {
    WEBVIEWS
        .with(|m| m.borrow().get(tab_id).cloned())
        .ok_or_else(|| NativeSurfaceError::NoWebview(format!("no webview: {tab_id}")))
}

/// Load `url` in an existing webview. Typed end to end (round 4, #31): the
/// caller's closure in `ai_transactions::navigate_native` takes this error as is.
pub fn navigate(app: &AppHandle, tab_id: String, url: String) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        let url_obj = ns_url(&url)?;
        let req = NSURLRequest::requestWithURL(&url_obj);
        // Drive the navigation + first paint (see create()), owned by the delegate.
        api_navigation(&tab_id, &webview, || {
            unsafe { webview.loadRequest(&req) }.is_some()
        });
        Ok(())
    })
}

/// Go back/forward in history. No-op if nowhere to go; the nav delegate
/// reports the resulting load so the chrome updates like any other.
pub fn go_history(
    app: &AppHandle,
    tab_id: String,
    forward: bool,
) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        let wv = webview_for(&tab_id)?;
        api_navigation(&tab_id, &wv, || {
            if forward {
                unsafe { wv.goForward() }.is_some()
            } else {
                unsafe { wv.goBack() }.is_some()
            }
        });
        Ok(())
    })
}

/// Run an API-initiated navigation call through the tab's delegate, which owns the
/// URL change the call publishes synchronously and drives the load to first paint
/// (`nav_api_navigation.rs`). Returns whether WebKit created a navigation. A webview
/// without its delegate cannot happen — `create` registers both together — but if it
/// does, the call is still made and driven, so a user's back button never goes dead
/// over a bookkeeping fault.
fn api_navigation(tab_id: &str, webview: &WKWebView, start: impl FnOnce() -> bool) -> bool {
    let pump = |wv: &WKWebView| drive_load(wv, &NSRunLoop::mainRunLoop());
    match delegate_for(tab_id) {
        Some(delegate) => delegate.api_navigation(webview, start, pump),
        None => {
            log::error!("[browser] {tab_id}: webview with no delegate — navigating unowned");
            let created = start();
            if created {
                pump(webview);
            }
            created
        }
    }
}

/// The tab's navigation delegate, cloned out of the map so no `RefCell` borrow is
/// held while the call it serves pumps the run loop (see `webview_for`).
fn delegate_for(tab_id: &str) -> Option<Retained<NavDelegate>> {
    DELEGATES.with(|m| m.borrow().get(tab_id).cloned())
}

/// Reposition/resize the native webview within the window (points).
pub fn set_bounds(
    app: &AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        // The frontend measured a DOM rect; AppKit needs it in the parent's
        // coordinate space (see surface_view_macos::frame_for_dom_rect).
        webview.setFrame(frame_for_dom_rect(&webview, x, y, width, height));
        Ok(())
    })
}

/// Resume a parked `confirm()` dialog with the user's answer (WI-1.7) — but only
/// from the window that owns the dialog's tab (audit 20260903).
///
/// A dialog id is a small integer that travels through the frontend; a guessed or
/// stale one from another window must not answer a page that window cannot see.
/// The parked dialog knows its tab, the registry knows the tab's window, and the
/// two must agree or the answer is refused (`DIALOG_NOT_OWNED`) and the dialog
/// stays parked for its rightful window. An unknown id is still a no-op: it was
/// already answered or drained, and there is nothing left to protect.
pub fn dialog_respond(
    app: &AppHandle,
    id: u64,
    accepted: bool,
    window_label: String,
) -> Result<(), NativeSurfaceError> {
    let app_for_closure = app.clone();
    on_main(app, move |_mtm| {
        let Some(tab_id) = dialogs::tab_of(id) else {
            return Ok(());
        };
        let Some(state) = app_for_closure.try_state::<BrowserSurface>() else {
            return Err(NativeSurfaceError::Unclassified(
                "browser state is not managed".to_string(),
            ));
        };
        let owned = {
            let reg = state.registry.lock().map_err(|_| {
                NativeSurfaceError::Unclassified("browser registry lock poisoned".to_string())
            })?;
            reg.tab_belongs_to_window(&tab_id, &window_label)
        };
        if !owned {
            return Err(NativeSurfaceError::DialogNotOwned(format!(
                "dialog #{id} belongs to another window"
            )));
        }
        dialogs::respond(id, accepted);
        Ok(())
    })
}

/// Hide (freeze) or show (thaw) the native view — the occlusion mechanism
/// (R2/WI-1.4). Hiding lets a DOM overlay paint in the rect instead of the
/// live page that would otherwise sit above all DOM.
pub fn set_hidden(app: &AppHandle, tab_id: String, hidden: bool) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        webview.setHidden(hidden);
        Ok(())
    })
}

/// Run the no-bridge assertion in the PAGE world (R3/SPIKE-1) and return its
/// JSON result — page world (not isolated) so it inspects the page's own
/// globals, proving no Tauri bridge leaked in. The driver's own read/act
/// primitive is `eval` (eval_macos.rs), which runs in the isolated world.
pub fn assert_no_bridge(app: &AppHandle, tab_id: String) -> Result<String, EvalError> {
    let native = on_main(app, move |mtm| {
        let webview = webview_for(&tab_id)?;
        let run_loop = NSRunLoop::mainRunLoop();
        let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
        Ok(eval_js(
            &webview,
            crate::browser::no_bridge::NO_BRIDGE_ASSERTION,
            &page_world,
            &run_loop,
        )
        .map_err(EvalError::from))
    });
    EvalError::flatten(native)
}

/// Stop the tab's current load. No-op if nothing is loading.
pub fn stop(app: &AppHandle, tab_id: String) -> Result<(), NativeSurfaceError> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        unsafe { webview.stopLoading() };
        Ok(())
    })
}
