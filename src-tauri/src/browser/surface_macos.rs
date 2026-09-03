//! macOS native browser surface — the objc2 WKWebView implementation of the
//! WI-1.2 surface. Split from surface.rs (which keeps the cross-platform
//! struct + command-facing re-exports) to stay under the file-size limit.
//! Included via `#[path]` from surface.rs; `super::` refers to that module.

use crate::browser::eval_outcome::EvalError;
use crate::browser::surface::BrowserSurface;
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSRunLoop, NSURLRequest};
use objc2_web_kit::{WKContentWorld, WKWebView};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc;
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

/// Run `f` on the main thread and return its result (20s cap).
fn on_main<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(MainThreadMarker) -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = match MainThreadMarker::new() {
            Some(mtm) => f(mtm),
            None => Err("no MainThreadMarker".to_string()),
        };
        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(20)).map_err(|_| {
        format!(
            "{fail}: main-thread op timed out",
            fail = crate::browser::surface::fail::MAIN_THREAD_TIMEOUT
        )
    })?
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
pub fn clear_ai_sandbox_store(app: &AppHandle) -> Result<(), String> {
    on_main(app, move |_mtm| {
        browser_store::clear();
        Ok(())
    })
}

/// The live webview for `tab_id`, or the tagged `NO_WEBVIEW` failure. Clones the
/// handle out of the map so no `RefCell` borrow is held while the run loop is
/// pumped (a pump can re-enter WEBVIEWS).
fn webview_for(tab_id: &str) -> Result<Retained<WKWebView>, String> {
    WEBVIEWS
        .with(|m| m.borrow().get(tab_id).cloned())
        .ok_or_else(|| {
            format!(
                "{}: no webview: {tab_id}",
                crate::browser::surface::fail::NO_WEBVIEW
            )
        })
}

/// Load `url` in an existing webview.
pub fn navigate(app: &AppHandle, tab_id: String, url: String) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        let url_obj = ns_url(&url)?;
        let req = NSURLRequest::requestWithURL(&url_obj);
        let _ = unsafe { webview.loadRequest(&req) };
        // Drive the navigation + first paint (see create()).
        let run_loop = NSRunLoop::mainRunLoop();
        drive_load(&webview, &run_loop);
        Ok(())
    })
}

/// Go back/forward in history. No-op if nowhere to go; the nav delegate
/// reports the resulting load so the chrome updates like any other.
pub fn go_history(app: &AppHandle, tab_id: String, forward: bool) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let wv = webview_for(&tab_id)?;
        let nav = if forward {
            unsafe { wv.goForward() }
        } else {
            unsafe { wv.goBack() }
        };
        if nav.is_some() {
            drive_load(&wv, &NSRunLoop::mainRunLoop());
        }
        Ok(())
    })
}

/// Reposition/resize the native webview within the window (points).
pub fn set_bounds(
    app: &AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
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
) -> Result<(), String> {
    let app_for_closure = app.clone();
    on_main(app, move |_mtm| {
        let Some(tab_id) = dialogs::tab_of(id) else {
            return Ok(());
        };
        let owned = app_for_closure
            .try_state::<BrowserSurface>()
            .and_then(|state| {
                state
                    .registry
                    .lock()
                    .ok()
                    .map(|reg| reg.tab_belongs_to_window(&tab_id, &window_label))
            })
            .unwrap_or(false);
        if !owned {
            return Err(format!(
                "{}: dialog #{id} belongs to another window",
                crate::browser::surface::fail::DIALOG_NOT_OWNED
            ));
        }
        dialogs::respond(id, accepted);
        Ok(())
    })
}

/// Hide (freeze) or show (thaw) the native view — the occlusion mechanism
/// (R2/WI-1.4). Hiding lets a DOM overlay paint in the rect instead of the
/// live page that would otherwise sit above all DOM.
pub fn set_hidden(app: &AppHandle, tab_id: String, hidden: bool) -> Result<(), String> {
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
        ))
    });
    EvalError::flatten(native)
}

/// Stop the tab's current load. No-op if nothing is loading.
pub fn stop(app: &AppHandle, tab_id: String) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let webview = webview_for(&tab_id)?;
        unsafe { webview.stopLoading() };
        Ok(())
    })
}
