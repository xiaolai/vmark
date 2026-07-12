//! macOS native browser surface — the objc2 WKWebView implementation of the
//! WI-1.2 surface. Split from surface.rs (which keeps the cross-platform
//! struct + command-facing re-exports) to stay under the file-size limit.
//! Included via `#[path]` from surface.rs; `super::` refers to that module.

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
            // Drive the first navigation + paint. A freshly added WKWebView does
            // not begin rendering until the run loop cycles; the app's loop will,
            // but pumping briefly here makes create deterministic (the spike did
            // the same). Bounded so create stays responsive.
            let run_loop = NSRunLoop::mainRunLoop();
            drive_load(&webview, &run_loop);
            WEBVIEWS.with(|m| m.borrow_mut().insert(tab_id, webview));
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
                world,
                Some(&handler),
            );
        }
        let mut waited = 0.0;
        while out.borrow().is_none() && waited < 5.0 {
            pump(run_loop, 0.05);
            waited += 0.05;
        }
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
            Ok(eval_js(&webview, super::NO_BRIDGE_ASSERTION, &page_world, &run_loop))
        })
    }

    /// Pump the main run loop for `secs` so async WebKit callbacks fire while a
    /// synchronous command awaits them on the main thread.
    fn pump(run_loop: &NSRunLoop, secs: f64) {
        let until = objc2_foundation::NSDate::dateWithTimeIntervalSinceNow(secs);
        run_loop.runUntilDate(&until);
    }

    /// Drive a navigation to first paint by pumping the run loop until the
    /// webview stops loading (capped). Because `pump` explicitly cycles the loop,
    /// this completes the load even when the app is App-Nap-throttled (window
    /// unfocused) — the idle loop alone would stall it. Returns once the initial
    /// load settles or `MAX` elapses.
    fn drive_load(webview: &WKWebView, run_loop: &NSRunLoop) {
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
