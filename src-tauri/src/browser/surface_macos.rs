//! macOS native browser surface — the objc2 WKWebView implementation of the
//! WI-1.2 surface. Split from surface.rs (which keeps the cross-platform
//! struct + command-facing re-exports) to stay under the file-size limit.
//! Included via `#[path]` from surface.rs; `super::` refers to that module.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSError, NSRunLoop, NSString, NSURLRequest};
use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;
use tauri::AppHandle;

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

#[path = "screenshot_macos.rs"]
pub mod screenshot;

thread_local! {
    /// Main-thread-only live webviews, keyed by tab id.
    static WEBVIEWS: RefCell<HashMap<String, Retained<WKWebView>>> = RefCell::new(HashMap::new());
    /// Navigation delegates, kept alive here because `WKWebView` holds its
    /// `navigationDelegate` **weakly** — dropping the `Retained` would silently
    /// stop all lifecycle/crash callbacks. Cleared in `destroy`.
    static DELEGATES: RefCell<HashMap<String, Retained<NavDelegate>>> = RefCell::new(HashMap::new());
}

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
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "main-thread op timed out".to_string())?
}

#[path = "surface_view_macos.rs"]
mod view;
use view::{content_view, frame_for_dom_rect, js_result_to_string, ns_url};

/// Create the native webview for `tab_id`, add it as a subview of the
/// `window_label` window's content view, and load `url`.
pub fn create(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    url: String,
) -> Result<(), String> {
    create_with_mode(app, tab_id, window_label, url, super::super::registry::AutomationMode::Human)
}

/// Create a browser webview with an explicit data-store posture. The store is
/// selected before WKWebView construction, which is the only safe WebKit seam.
pub fn create_with_mode(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    url: String,
    mode: super::super::registry::AutomationMode,
) -> Result<(), String> {
    let app_handle = app.clone();
    on_main(app, move |mtm| {
        // Validate all fallible inputs before registering native objects.
        let parent = content_view(&app_handle, &window_label, mtm)?;
        let url_obj = ns_url(&url)?;
        let req = NSURLRequest::requestWithURL(&url_obj);

        // Start at zero size; the frontend supplies the measured browser rect immediately.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        browser_store::configure(&config, mtm, mode);
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), CGRect::ZERO, &config)
        };
        // Evict before replacing the delegate so the old view is removed and its KVO
        // observer is detached before its retained delegate is released.
        evict_existing(&tab_id);
        // Attach the navigation delegate BEFORE the first load so its lifecycle
        // events (commit/finish/fail) fire for that load too. Held in DELEGATES
        // because WKWebView's navigationDelegate reference is weak.
        let delegate = NavDelegate::new(mtm, tab_id.clone(), app_handle);
        unsafe {
            webview.setNavigationDelegate(Some(delegate.as_protocol()));
            webview.setUIDelegate(Some(delegate.as_ui_protocol()));
        }
        delegate.observe_url(&webview);
        // BOTH maps, together, BEFORE anything can pump the run loop — the pairing
        // invariant that makes teardown sound. See surface_lifecycle_macos.rs.
        DELEGATES.with(|m| m.borrow_mut().insert(tab_id.clone(), delegate));
        WEBVIEWS.with(|m| m.borrow_mut().insert(tab_id.clone(), webview.clone()));
        let _ = unsafe { webview.loadRequest(&req) };
        parent.addSubview(&webview);
        // Drive the first navigation + paint with a bounded run-loop pump.
        let run_loop = NSRunLoop::mainRunLoop();
        drive_load(&webview, &run_loop);
        Ok(())
    })
}

/// Release the sandbox profile after AI views are torn down or posture changes.
pub fn clear_ai_sandbox_store(app: &AppHandle) -> Result<(), String> {
    on_main(app, move |_mtm| {
        browser_store::clear();
        Ok(())
    })
}

/// Load `url` in an existing webview. Clones the handle out of the map first
/// so no `RefCell` borrow is held while the run loop is pumped (a pump can
/// re-enter WEBVIEWS).
pub fn navigate(app: &AppHandle, tab_id: String, url: String) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
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
        let wv = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
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
        WEBVIEWS.with(|m| {
            let map = m.borrow();
            let webview = map
                .get(&tab_id)
                .ok_or_else(|| format!("no webview: {tab_id}"))?;
            // The frontend measured a DOM rect; AppKit needs it in the parent's
            // coordinate space (see surface_view_macos::frame_for_dom_rect).
            webview.setFrame(frame_for_dom_rect(webview, x, y, width, height));
            Ok(())
        })
    })
}

/// Resume a parked `confirm()` dialog with the user's answer (WI-1.7).
pub fn dialog_respond(app: &AppHandle, id: u64, accepted: bool) -> Result<(), String> {
    on_main(app, move |_mtm| {
        dialogs::respond(id, accepted);
        Ok(())
    })
}

/// Hide (freeze) or show (thaw) the native view — the occlusion mechanism
/// (R2/WI-1.4). Hiding lets a DOM overlay paint in the rect instead of the
/// live page that would otherwise sit above all DOM.
pub fn set_hidden(app: &AppHandle, tab_id: String, hidden: bool) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        webview.setHidden(hidden);
        Ok(())
    })
}

/// Evaluate `script` in `world`, pumping the run loop until the async result
/// arrives (capped). Scripts should `return` a JSON-serializable value;
/// the string result (or "<null>"/"<timeout>") is returned as-is.
fn eval_js(
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

/// Evaluate `script` in the driver's ISOLATED content world (R10/I2) and
/// return its string result. The agent shares the page DOM (reads work) but
/// is isolated from the page's own JS — the page can neither observe nor
/// tamper with the agent. This is the driver's read/act primitive (WI-2.1).
pub fn eval(app: &AppHandle, tab_id: String, script: String) -> Result<String, String> {
    on_main(app, move |mtm| {
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        let run_loop = NSRunLoop::mainRunLoop();
        let world =
            unsafe { WKContentWorld::worldWithName(&NSString::from_str("vmark-agent"), mtm) };
        Ok(eval_js(&webview, &script, &world, &run_loop))
    })
}

/// Run the no-bridge assertion in the PAGE world (R3/SPIKE-1) and return its
/// JSON result — page world (not isolated) so it inspects the page's own
/// globals, proving no Tauri bridge leaked in.
pub fn assert_no_bridge(app: &AppHandle, tab_id: String) -> Result<String, String> {
    on_main(app, move |mtm| {
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        let run_loop = NSRunLoop::mainRunLoop();
        let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
        Ok(eval_js(
            &webview,
            super::NO_BRIDGE_ASSERTION,
            &page_world,
            &run_loop,
        ))
    })
}

/// Stop the tab's current load. No-op if nothing is loading.
pub fn stop(app: &AppHandle, tab_id: String) -> Result<(), String> {
    on_main(app, move |_mtm| {
        let webview = WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        unsafe { webview.stopLoading() };
        Ok(())
    })
}
