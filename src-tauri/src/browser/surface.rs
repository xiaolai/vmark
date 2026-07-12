//! Native browser surface — a VMark-owned WKWebView (WI-1.2, macOS).
//!
//! VMark constructs the `WKWebView` itself (fresh `WKWebViewConfiguration`,
//! ADR-B2) and adds it as an `NSView` subview of the Tauri window's content
//! view. Because Tauri did not create it, Tauri's IPC bridge is never injected —
//! the `assert_no_bridge` command exists to prove that as a live regression
//! check (R3 / SPIKE-1).
//!
//! Threading + ownership: all AppKit/WebKit calls run on the main thread via
//! `run_on_main_thread`. A `Retained<WKWebView>` is not `Send`, so the live
//! handles live in a **main-thread-local** map (`WEBVIEWS`), reached only from
//! inside main-thread closures. The `Send` lifecycle/identity registry
//! (`browser/registry.rs`) lives in Tauri-managed state; the two are kept
//! consistent by the command layer.
//!
//! The macOS objc2 recipe is the productionized form of the validated Phase-0
//! spike (git cd162e02:src-tauri/src/spike_embed.rs).

use crate::browser::registry::BrowserRegistry;
use std::sync::Mutex;

/// Tauri-managed browser state: the platform-independent lifecycle/identity
/// registry (Send). Native handles are held per-platform, off this struct.
#[derive(Default)]
pub struct BrowserSurface {
    pub registry: Mutex<BrowserRegistry>,
}

/// The read-only JS that asserts no Tauri bridge leaked into the browsed page
/// (R3 / SPIKE-1). Returns a JSON object of booleans; all must be false.
pub const NO_BRIDGE_ASSERTION: &str = "return JSON.stringify({\
    hasTauriInternals: typeof window.__TAURI_INTERNALS__ !== 'undefined',\
    hasTauri: typeof window.__TAURI__ !== 'undefined',\
    hasIpc: typeof window.ipc !== 'undefined',\
    invokeReachable: (function(){try{return typeof window.__TAURI_INTERNALS__.invoke==='function';}catch(e){return false;}})()\
});";

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSWindow};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSError, NSRunLoop, NSString, NSURLRequest, NSURL};
    use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::AppHandle;

    thread_local! {
        /// Main-thread-only live webviews, keyed by tab id.
        static WEBVIEWS: RefCell<HashMap<String, Retained<WKWebView>>> = RefCell::new(HashMap::new());
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

    /// The Tauri window's content view (the parent for our native subview).
    fn content_view(
        mtm: MainThreadMarker,
    ) -> Result<Retained<objc2_app_kit::NSView>, String> {
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let window = window.ok_or_else(|| "no key window".to_string())?;
        window.contentView().ok_or_else(|| "no contentView".to_string())
    }

    fn ns_url(url: &str) -> Result<Retained<NSURL>, String> {
        NSURL::URLWithString(&NSString::from_str(url))
            .ok_or_else(|| format!("invalid URL: {url}"))
    }

    /// Create the native webview for `tab_id`, add it as a subview, and load `url`.
    pub fn create(app: &AppHandle, tab_id: String, url: String) -> Result<(), String> {
        on_main(app, move |mtm| {
            let parent = content_view(mtm)?;
            let bounds = parent.bounds();
            let config = unsafe { WKWebViewConfiguration::new(mtm) };
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
            };
            let url_obj = ns_url(&url)?;
            let req = NSURLRequest::requestWithURL(&url_obj);
            let _ = unsafe { webview.loadRequest(&req) };
            parent.addSubview(&webview);
            WEBVIEWS.with(|m| m.borrow_mut().insert(tab_id, webview));
            Ok(())
        })
    }

    /// Load `url` in an existing webview.
    pub fn navigate(app: &AppHandle, tab_id: String, url: String) -> Result<(), String> {
        on_main(app, move |_mtm| {
            WEBVIEWS.with(|m| {
                let map = m.borrow();
                let webview = map.get(&tab_id).ok_or_else(|| format!("no webview: {tab_id}"))?;
                let url_obj = ns_url(&url)?;
                let req = NSURLRequest::requestWithURL(&url_obj);
                let _ = unsafe { webview.loadRequest(&req) };
                Ok(())
            })
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
                let webview = map.get(&tab_id).ok_or_else(|| format!("no webview: {tab_id}"))?;
                let rect = CGRect {
                    origin: CGPoint { x, y },
                    size: CGSize { width, height },
                };
                webview.setFrame(rect);
                Ok(())
            })
        })
    }

    /// Tear down and drop the native webview.
    pub fn destroy(app: &AppHandle, tab_id: String) -> Result<(), String> {
        on_main(app, move |_mtm| {
            WEBVIEWS.with(|m| {
                if let Some(webview) = m.borrow_mut().remove(&tab_id) {
                    webview.removeFromSuperview();
                }
            });
            Ok(())
        })
    }

    /// Evaluate the no-bridge assertion in the page and return its JSON result.
    pub fn assert_no_bridge(app: &AppHandle, tab_id: String) -> Result<String, String> {
        on_main(app, move |mtm| {
            let webview = WEBVIEWS
                .with(|m| m.borrow().get(&tab_id).cloned())
                .ok_or_else(|| format!("no webview: {tab_id}"))?;
            let run_loop = NSRunLoop::mainRunLoop();
            let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
            let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
            let body = NSString::from_str(super::NO_BRIDGE_ASSERTION);
            let sink = out.clone();
            let handler = block2::RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
                if value.is_null() {
                    *sink.borrow_mut() = Some("<null>".into());
                } else {
                    let ns: *const NSString = value.cast();
                    *sink.borrow_mut() = Some(unsafe { (*ns).to_string() });
                }
            });
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &body,
                    None,
                    None,
                    &page_world,
                    Some(&handler),
                );
            }
            let mut waited = 0.0;
            while out.borrow().is_none() && waited < 5.0 {
                pump(&run_loop, 0.05);
                waited += 0.05;
            }
            let res = out.borrow().clone().unwrap_or_else(|| "<timeout>".into());
            Ok(res)
        })
    }

    /// Pump the main run loop for `secs` so async WebKit callbacks fire while a
    /// synchronous command awaits them on the main thread.
    fn pump(run_loop: &NSRunLoop, secs: f64) {
        let until = objc2_foundation::NSDate::dateWithTimeIntervalSinceNow(secs);
        run_loop.runUntilDate(&until);
    }
}

// --- Cross-platform command-facing API -------------------------------------
// macOS delegates to `imp`; other platforms return an explicit "unsupported"
// (their native backends land in WI-5.1 / WI-5.2).

#[cfg(target_os = "macos")]
pub use imp::{assert_no_bridge, create, destroy, navigate, set_bounds};

#[cfg(not(target_os = "macos"))]
mod stub {
    use tauri::AppHandle;
    const MSG: &str = "embedded browser surface is macOS-only in this build";
    pub fn create(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn navigate(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn set_bounds(
        _a: &AppHandle,
        _t: String,
        _x: f64,
        _y: f64,
        _w: f64,
        _h: f64,
    ) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn destroy(_a: &AppHandle, _t: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn assert_no_bridge(_a: &AppHandle, _t: String) -> Result<String, String> {
        Err(MSG.into())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::{assert_no_bridge, create, destroy, navigate, set_bounds};
