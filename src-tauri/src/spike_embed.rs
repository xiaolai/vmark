//! SPIKE-1 embedding probe (WI-0.1) — DEBUG-ONLY, macOS-only, THROWAWAY.
//!
//! Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
//!
//! Confirms the *embedding* half of SPIKE-1: a WKWebView that VMark constructs itself
//! (fresh `WKWebViewConfiguration`, ADR-B2) can be added as an `NSView` subview of the
//! REAL Tauri window's content view and render visibly. This is the one architectural
//! question the standalone `spike1-probe` could not answer (it used its own webview,
//! not Tauri's window), and the specific risk Codex round-2 flagged (does wry reclaim
//! the content view?). Invoked over the automation bridge, observed via screenshot.
//!
//! This command is compiled ONLY in debug builds and must be deleted before the real
//! embedded-browser feature (WI-1.2) lands.

/// Embed a VMark-owned WKWebView into the main window's content view. Returns "embedded"
/// on success. Debug + macOS only; a no-op stub elsewhere so registration is uniform.
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_embed_browser(app: tauri::AppHandle) -> Result<String, String> {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use objc2::rc::Retained;
        use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSApplication, NSWindow};
        use objc2_foundation::NSString;
        use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no MainThreadMarker".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        // Prefer the key (focused) window; fall back to the first window.
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no NSWindow".into()));
            return;
        };
        let title = window.title().to_string();
        let is_key = window.isKeyWindow();
        let window_number = window.windowNumber();
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        // Fill the content view's bounds so position can't hide it.
        let bounds = content_view.bounds();

        // Fresh configuration — the ADR-B2 crux (nothing routed through Tauri).
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };

        let html = NSString::from_str(
            "<html><body style=\"margin:0;background:#e53935;color:#fff;\
             font:bold 56px -apple-system,sans-serif;display:flex;align-items:center;\
             justify-content:center;height:100vh\">SPIKE-1 EMBEDDED WEBVIEW OK</body></html>",
        );
        unsafe { webview.loadHTMLString_baseURL(&html, None) };

        // addSubview appends → topmost; it also retains the webview.
        content_view.addSubview(&webview);
        let superview_ok = unsafe { webview.superview() }.is_some();

        let report = format!(
            "{{\"embedded\":true,\"windowTitle\":\"{title}\",\"isKeyWindow\":{is_key},\
             \"windowNumber\":{window_number},\"contentW\":{:.0},\"contentH\":{:.0},\
             \"superviewAttached\":{superview_ok}}}",
            bounds.size.width, bounds.size.height
        );
        let _ = tx.send(Ok(report));
    })
    .map_err(|e| format!("failed to reach main thread: {e}"))?;

    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "timed out embedding webview".to_string())?
}

/// SPIKE-5 — occlusion primitive. Embeds a webview, then `takeSnapshot`s it and reports
/// capture latency + image dimensions. Proves the freeze-to-snapshot capture (R2) works
/// and how fast (target < 100ms).
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_snapshot(app: tauri::AppHandle) -> Result<String, String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2::rc::Retained;
        use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSApplication, NSImage, NSWindow};
        use objc2_foundation::{NSError, NSRunLoop, NSString};
        use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no window".into()));
            return;
        };
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        let bounds = content_view.bounds();
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };
        let html = NSString::from_str(
            "<html><body style=\"margin:0;background:#43a047;color:#fff;font:bold 48px sans-serif;\
             display:flex;align-items:center;justify-content:center;height:100vh\">SNAPSHOT TARGET</body></html>",
        );
        unsafe { webview.loadHTMLString_baseURL(&html, None) };
        content_view.addSubview(&webview);

        let run_loop = NSRunLoop::mainRunLoop();
        // let the page paint
        pump(&run_loop, 0.8);

        let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let started = Instant::now();
        {
            let sink = out.clone();
            let handler = RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
                let ms = started.elapsed().as_millis();
                if image.is_null() {
                    *sink.borrow_mut() = Some(format!("{{\"ok\":false,\"latencyMs\":{ms}}}"));
                } else {
                    let size = unsafe { (*image).size() };
                    *sink.borrow_mut() = Some(format!(
                        "{{\"ok\":true,\"latencyMs\":{ms},\"imgW\":{:.0},\"imgH\":{:.0}}}",
                        size.width, size.height
                    ));
                }
            });
            // None config = snapshot the whole view.
            unsafe { webview.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
            let mut waited = 0.0;
            while out.borrow().is_none() && waited < 5.0 {
                pump(&run_loop, 0.02);
                waited += 0.02;
            }
        }
        let msg = out.borrow().clone().unwrap_or_else(|| "{\"ok\":false,\"timeout\":true}".into());
        // clean up the probe view
        webview.removeFromSuperview();
        let _ = tx.send(Ok(msg));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|_| "timed out".to_string())?
}

/// SPIKE-4 — profile data store. Reports the macOS version, whether an *identified*
/// `WKWebsiteDataStore` can be created without crashing (#12843), and whether the default
/// store is persistent. Isolation via identifier is macOS 14+; below that the default
/// persistent store is the fallback (persistence kept, isolation lost — ADR-B4).
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_datastore(app: tauri::AppHandle) -> Result<String, String> {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_foundation::{NSProcessInfo, NSUUID};
        use objc2_web_kit::WKWebsiteDataStore;

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let version = NSProcessInfo::processInfo().operatingSystemVersion();
        let major = version.majorVersion;

        let mut identifier_store_ok = false;
        if major >= 14 {
            // The #12843 crash concern: does creating an identified store abort?
            let uuid = NSUUID::new();
            let _store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
            identifier_store_ok = true; // reached here ⇒ no crash
        }
        let default = unsafe { WKWebsiteDataStore::defaultDataStore(mtm) };
        let persistent = unsafe { default.isPersistent() };

        let report = format!(
            "{{\"macOSMajor\":{major},\"identifierStoreOk\":{identifier_store_ok},\
             \"defaultPersistent\":{persistent}}}"
        );
        let _ = tx.send(Ok(report));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "timed out".to_string())?
}

/// SPIKE-3 — trusted input. Embeds a webview whose page records `event.isTrusted` on any
/// click, synthesizes an `NSEvent` mouse down+up into the window, then reads back whether
/// the DOM saw the click and whether it was trusted. Answers Q6 (is NSEvent synthesis
/// trusted on macOS, or is trusted input Windows-only?). A "received but untrusted" or
/// "not received" result is a valid FAIL — do not paper over it.
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_trusted_input(app: tauri::AppHandle) -> Result<String, String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{
            NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSWindow,
        };
        use objc2_core_foundation::CGPoint;
        use objc2_foundation::{NSError, NSRunLoop, NSString};
        use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no window".into()));
            return;
        };
        let win_num = window.windowNumber();
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        let bounds = content_view.bounds();
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };
        // Any click anywhere records receipt + isTrusted — no precise hit-testing needed.
        let html = NSString::from_str(
            "<html><body style=\"margin:0;height:100vh;background:#8e24aa\">\
             <script>window.__c={received:false};\
             document.addEventListener('click',e=>{window.__c={received:true,trusted:e.isTrusted};},true);\
             </script></body></html>",
        );
        unsafe { webview.loadHTMLString_baseURL(&html, None) };
        content_view.addSubview(&webview);
        let run_loop = NSRunLoop::mainRunLoop();
        pump(&run_loop, 0.8);

        // Click at the centre of the content view, in window (bottom-left) coordinates.
        let loc = CGPoint::new(bounds.size.width / 2.0, bounds.size.height / 2.0);
        let mk = |etype: NSEventType, pressure: f32| unsafe {
            NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                etype,
                loc,
                NSEventModifierFlags::empty(),
                0.0,
                win_num,
                None,
                0,
                1,
                pressure,
            )
        };
        // Bring the app forward and make the webview first responder, then POST the
        // events to the queue (normal hit-testing/responder routing) rather than
        // sendEvent (which bypasses the queue and failed to deliver from the background).
        #[allow(deprecated)]
        unsafe {
            ns_app.activateIgnoringOtherApps(true)
        };
        window.makeKeyAndOrderFront(None);
        let _ = window.makeFirstResponder(Some(&webview));
        pump(&run_loop, 0.2);
        if let Some(down) = mk(NSEventType::LeftMouseDown, 1.0) {
            unsafe { ns_app.postEvent_atStart(&down, false) };
        }
        if let Some(up) = mk(NSEventType::LeftMouseUp, 0.0) {
            unsafe { ns_app.postEvent_atStart(&up, false) };
        }
        pump(&run_loop, 0.5);

        // Read back what the DOM saw.
        let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
        let body = NSString::from_str("return JSON.stringify(window.__c || {received:false});");
        {
            let sink = out.clone();
            let handler = RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
                if value.is_null() {
                    *sink.borrow_mut() = Some("<null>".into());
                } else {
                    let ns: *const NSString = value.cast();
                    *sink.borrow_mut() = Some(unsafe { (*ns).to_string() });
                }
            });
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &body, None, None, &page_world, Some(&handler),
                );
            }
            let mut waited = 0.0;
            while out.borrow().is_none() && waited < 4.0 {
                pump(&run_loop, 0.02);
                waited += 0.02;
            }
        }
        let dom = out.borrow().clone().unwrap_or_else(|| "<timeout>".into());
        webview.removeFromSuperview();
        let _ = tx.send(Ok(format!("{{\"domResult\":{dom}}}")));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|_| "timed out".to_string())?
}

/// SPIKE-7 — publishing MECHANISM (not a real publish). Validates ADR-S4's core: an
/// in-page `fetch()` with `credentials:'include'` carries the session cookie and its
/// Promise is awaited via `callAsyncJavaScript`. Navigates to a public cookie-echo
/// endpoint, sets a cookie, then fetches it back same-origin. (Real platform publish +
/// CSRF acquisition needs a self-hosted target — out of this probe's scope.)
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_fetch(app: tauri::AppHandle) -> Result<String, String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSApplication, NSWindow};
        use objc2_foundation::{NSError, NSRunLoop, NSString, NSURLRequest, NSURL};
        use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no window".into()));
            return;
        };
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        let bounds = content_view.bounds();
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };
        content_view.addSubview(&webview);

        // Navigate to a same-origin cookie-setting endpoint.
        let url = unsafe {
            NSURL::URLWithString(&NSString::from_str("https://httpbin.org/cookies/set/spikeauth/ok123"))
        };
        if let Some(url) = url {
            let req = unsafe { NSURLRequest::requestWithURL(&url) };
            let _ = unsafe { webview.loadRequest(&req) };
        }
        let run_loop = NSRunLoop::mainRunLoop();
        pump(&run_loop, 7.0); // allow navigation + redirect to /cookies to COMPLETE

        // In-page credentialed fetch. RELATIVE url ⇒ same-origin by construction (a
        // cross-origin credentialed fetch would be rejected: httpbin sends
        // `Access-Control-Allow-Origin: *`, which browsers refuse with credentials).
        let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
        let body = NSString::from_str(
            "const href = location.href; \
             try { const r = await fetch('/cookies', {credentials:'include'}); \
             const j = await r.json(); return JSON.stringify({ok:true, href, cookies:j.cookies||{}}); } \
             catch(e) { return JSON.stringify({ok:false, href, err:String(e)}); }",
        );
        {
            let sink = out.clone();
            let handler = RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
                if value.is_null() {
                    *sink.borrow_mut() = Some("<null>".into());
                } else {
                    let ns: *const NSString = value.cast();
                    *sink.borrow_mut() = Some(unsafe { (*ns).to_string() });
                }
            });
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &body, None, None, &page_world, Some(&handler),
                );
            }
            let mut waited = 0.0;
            while out.borrow().is_none() && waited < 8.0 {
                pump(&run_loop, 0.05);
                waited += 0.05;
            }
        }
        let res = out.borrow().clone().unwrap_or_else(|| "<timeout>".into());
        webview.removeFromSuperview();
        let _ = tx.send(Ok(res));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "timed out".to_string())?
}

/// A fixed profile identifier so login state persists and is shared across probe
/// webviews (ADR-B4 persistent profile). 16 bytes, arbitrary but stable.
#[cfg(all(debug_assertions, target_os = "macos"))]
const SPIKE_PROFILE_UUID: &str = "5B1CE001-0000-4000-8000-00000000C0DE";

/// Give the user a REAL, interactive, persistent browser: embed a webview backed by a
/// stable `WKWebsiteDataStore` identifier and navigate it to `url`. Left in place (not
/// removed) so the user can interact with it directly — real HID input works (SPIKE-3
/// showed only *synthesized* input fails). Used to log into a platform for SPIKE-7.
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_open_browser(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use objc2::rc::Retained;
        use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSApplication, NSWindow};
        use objc2_foundation::{NSString, NSURLRequest, NSUUID, NSURL};
        use objc2_web_kit::{WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no window".into()));
            return;
        };
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        let bounds = content_view.bounds();

        // Persistent, identified profile (ADR-B4) so the login survives + is shared.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let uuid_str = NSString::from_str(SPIKE_PROFILE_UUID);
        if let Some(uuid) = unsafe { NSUUID::initWithUUIDString(NSUUID::alloc(), &uuid_str) } {
            let store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
            unsafe { config.setWebsiteDataStore(&store) };
        }
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };
        // Autoresize with the window so it stays usable on resize.
        webview.setAutoresizingMask(
            objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable
                | objc2_app_kit::NSAutoresizingMaskOptions::ViewHeightSizable,
        );

        let target = if url.is_empty() { "https://x.com/login".to_string() } else { url };
        if let Some(nsurl) = unsafe { NSURL::URLWithString(&NSString::from_str(&target)) } {
            let req = unsafe { NSURLRequest::requestWithURL(&nsurl) };
            let _ = unsafe { webview.loadRequest(&req) };
        }
        content_view.addSubview(&webview);
        // Bring the app forward so the user can interact immediately.
        #[allow(deprecated)]
        unsafe {
            ns_app.activateIgnoringOtherApps(true)
        };
        window.makeKeyAndOrderFront(None);
        let _ = window.makeFirstResponder(Some(&webview));

        let _ = tx.send(Ok(format!("{{\"opened\":true,\"url\":\"{target}\"}}")));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "timed out".to_string())?
}

/// SPIKE-7 (real, READ-ONLY): after the user logs in via `spike_open_browser`, prove the
/// session persisted in the shared profile and carries through an in-page fetch — WITHOUT
/// posting anything. Creates a fresh webview on the SAME profile identifier, navigates to
/// x.com/home, and reports the final URL + whether the CSRF cookie is present (logged in ⇒
/// stays on /home with a `ct0` cookie; logged out ⇒ redirected to a login flow).
#[cfg(all(debug_assertions, target_os = "macos"))]
#[tauri::command]
pub fn spike_session_check(app: tauri::AppHandle) -> Result<String, String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
        use objc2_app_kit::{NSApplication, NSWindow};
        use objc2_foundation::{NSError, NSRunLoop, NSString, NSURLRequest, NSUUID, NSURL};
        use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("no mtm".into()));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let window: Option<Retained<NSWindow>> =
            ns_app.keyWindow().or_else(|| ns_app.windows().firstObject());
        let Some(window) = window else {
            let _ = tx.send(Err("no window".into()));
            return;
        };
        let Some(content_view) = window.contentView() else {
            let _ = tx.send(Err("no contentView".into()));
            return;
        };
        let bounds = content_view.bounds();

        // Same identified profile ⇒ inherits the login the user did in spike_open_browser.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let uuid_str = NSString::from_str(SPIKE_PROFILE_UUID);
        if let Some(uuid) = unsafe { NSUUID::initWithUUIDString(NSUUID::alloc(), &uuid_str) } {
            let store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
            unsafe { config.setWebsiteDataStore(&store) };
        }
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config)
        };
        if let Some(nsurl) =
            unsafe { NSURL::URLWithString(&NSString::from_str("https://x.com/home")) }
        {
            let req = unsafe { NSURLRequest::requestWithURL(&nsurl) };
            let _ = unsafe { webview.loadRequest(&req) };
        }
        content_view.addSubview(&webview);
        let run_loop = NSRunLoop::mainRunLoop();
        pump(&run_loop, 6.0); // navigation + any auth redirect

        let out: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
        // READ ONLY: report where we landed + whether a CSRF cookie exists. No writes.
        let body = NSString::from_str(
            "return JSON.stringify({\
               href: location.href,\
               loggedIn: !/\\/(login|i\\/flow\\/login|account\\/access)/.test(location.pathname),\
               hasCsrfCookie: /(^|;\\s*)ct0=/.test(document.cookie)\
             });",
        );
        {
            let sink = out.clone();
            let handler = RcBlock::new(move |value: *mut AnyObject, _e: *mut NSError| {
                if value.is_null() {
                    *sink.borrow_mut() = Some("<null>".into());
                } else {
                    let ns: *const NSString = value.cast();
                    *sink.borrow_mut() = Some(unsafe { (*ns).to_string() });
                }
            });
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &body, None, None, &page_world, Some(&handler),
                );
            }
            let mut waited = 0.0;
            while out.borrow().is_none() && waited < 5.0 {
                pump(&run_loop, 0.05);
                waited += 0.05;
            }
        }
        let res = out.borrow().clone().unwrap_or_else(|| "<timeout>".into());
        webview.removeFromSuperview();
        let _ = tx.send(Ok(res));
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "timed out".to_string())?
}

/// Shared run-loop pump (mirrors the standalone spike1-probe).
#[cfg(all(debug_assertions, target_os = "macos"))]
fn pump(run_loop: &objc2_foundation::NSRunLoop, seconds: f64) {
    use objc2_foundation::{NSDate, NSDefaultRunLoopMode};
    let slices = (seconds / 0.02).max(1.0) as i32;
    for _ in 0..slices {
        let until = NSDate::dateWithTimeIntervalSinceNow(0.02);
        unsafe { run_loop.runMode_beforeDate(NSDefaultRunLoopMode, &until) };
    }
}

/// Non-macOS / release stubs so `generate_handler!` registration is unconditional.
#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_embed_browser() -> Result<String, String> {
    Err("spike_embed_browser is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_snapshot() -> Result<String, String> {
    Err("spike_snapshot is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_datastore() -> Result<String, String> {
    Err("spike_datastore is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_trusted_input() -> Result<String, String> {
    Err("spike_trusted_input is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_fetch() -> Result<String, String> {
    Err("spike_fetch is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_open_browser(_url: String) -> Result<String, String> {
    Err("spike_open_browser is a debug-only macOS probe".into())
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[tauri::command]
pub fn spike_session_check() -> Result<String, String> {
    Err("spike_session_check is a debug-only macOS probe".into())
}
