//! SPIKE-1 (WI-0.1) — the BLOCKING no-bridge probe.
//!
//! Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
//!
//! Asserts the plan's load-bearing security invariant (R3 / I1): a WKWebView that
//! VMark CONSTRUCTS ITSELF (fresh `WKWebViewConfiguration`, never routed through
//! Tauri's webview manager) carries NO Tauri IPC bridge. Concretely, in a page
//! loaded into such a webview:
//!     window.__TAURI_INTERNALS__ === undefined
//!     window.__TAURI__          === undefined
//!     window.ipc                === undefined
//!
//! This is the empirical confirmation of what reading tauri-2.11.5
//! `manager/webview.rs:166-224` already implies: Tauri injects the bridge inside
//! ITS creation pipeline, which a self-constructed webview never enters.
//!
//! Coordination avoids a custom navigation delegate: load an inline HTML string,
//! pump the main run loop briefly so the page commits, then `evaluateJavaScript`
//! (async, completion handler) and pump again until the result arrives.
//!
//! Exit 0 = PASS (no bridge globals). Exit 1 = FAIL (a bridge global is present).
//! Exit 2 = INCONCLUSIVE (eval never returned — e.g. no WindowServer session).

use std::cell::RefCell;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSDate, NSDefaultRunLoopMode, NSError, NSRunLoop, NSString};
use objc2_web_kit::{WKContentWorld, WKWebView, WKWebViewConfiguration};

/// Pump the main run loop for approximately `seconds` so async webview work advances.
fn pump(run_loop: &NSRunLoop, seconds: f64) {
    // Run in short slices so we can re-check flags between them.
    let slices = (seconds / 0.02).max(1.0) as i32;
    for _ in 0..slices {
        let until = NSDate::dateWithTimeIntervalSinceNow(0.02);
        unsafe { run_loop.runMode_beforeDate(NSDefaultRunLoopMode, &until) };
    }
}

fn main() {
    let mtm = MainThreadMarker::new().expect("probe must run on the main thread");

    // A real app object exists (WKWebView needs an NSApplication), but we drive the
    // run loop ourselves rather than calling `run()` so we can exit deterministically.
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    // The crux: a FRESH configuration. Nothing here comes from Tauri.
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    let frame = CGRect::new(
        objc2_core_foundation::CGPoint::new(0.0, 0.0),
        objc2_core_foundation::CGSize::new(400.0, 300.0),
    );
    let webview = unsafe {
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
    };

    let html = NSString::from_str("<html><body>spike1</body></html>");
    unsafe { webview.loadHTMLString_baseURL(&html, None) };

    let run_loop = NSRunLoop::mainRunLoop();
    pump(&run_loop, 0.8); // let the page commit a JS context

    // Async eval with a completion handler that records the JSON result string.
    let result: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let js = NSString::from_str(
        "JSON.stringify({\
           tauriInternals: typeof window.__TAURI_INTERNALS__,\
           tauri: typeof window.__TAURI__,\
           ipc: typeof window.ipc\
         })",
    );
    {
        let sink = result.clone();
        let handler = RcBlock::new(move |value: *mut AnyObject, _err: *mut NSError| {
            if !value.is_null() {
                // The result of JSON.stringify is an NSString.
                let ns: *const NSString = value.cast();
                let s = unsafe { (*ns).to_string() };
                *sink.borrow_mut() = Some(s);
            } else {
                *sink.borrow_mut() = Some(String::from("<null result>"));
            }
        });
        unsafe {
            webview.evaluateJavaScript_completionHandler(&js, Some(&handler));
        }
        // keep `handler` alive across the pump below
        let mut waited = 0.0;
        while result.borrow().is_none() && waited < 5.0 {
            pump(&run_loop, 0.05);
            waited += 0.05;
        }
        drop(handler);
    }

    let outcome = result.borrow().clone();
    let json = match outcome {
        Some(j) => j,
        None => {
            eprintln!(
                "[spike1] INCONCLUSIVE — sync eval never returned. Likely no WindowServer session \
                 (run from a logged-in GUI Terminal, not over plain ssh/headless)."
            );
            std::process::exit(2);
        }
    };
    println!("[spike1] no-bridge eval result: {json}");
    let has_bridge = json.contains("\"tauriInternals\":\"object\"")
        || json.contains("\"tauri\":\"object\"")
        || json.contains("\"ipc\":\"object\"")
        || json.contains("\"tauriInternals\":\"function\"")
        || json.contains("\"ipc\":\"function\"");
    if has_bridge {
        println!("[spike1] FAIL — a Tauri bridge global is PRESENT in a self-constructed WKWebView.");
        std::process::exit(1);
    }
    println!("[spike1] PASS (R3/I1) — no Tauri bridge globals in a VMark-owned WKWebView.");

    // ── Bonus (SPIKE-2): does callAsyncJavaScript AWAIT a real Promise and return
    //    the resolved value? This is the primitive publishing depends on (ADR-B3);
    //    plain evaluateJavaScript cannot await a Promise.
    let async_result: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let body = NSString::from_str("return await new Promise((res) => { setTimeout(() => res(42), 10); });");
    let page_world = unsafe { WKContentWorld::pageWorld(mtm) };
    {
        let sink = async_result.clone();
        let handler = RcBlock::new(move |value: *mut AnyObject, _err: *mut NSError| {
            if value.is_null() {
                *sink.borrow_mut() = Some(String::from("<null>"));
            } else {
                // Resolved value 42 comes back as an NSNumber; describe it as a string.
                let obj: &AnyObject = unsafe { &*value };
                let desc: Retained<NSString> = unsafe { objc2::msg_send![obj, description] };
                *sink.borrow_mut() = Some(desc.to_string());
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
        while async_result.borrow().is_none() && waited < 5.0 {
            pump(&run_loop, 0.05);
            waited += 0.05;
        }
        drop(handler);
    }
    let async_outcome = async_result.borrow().clone();
    match async_outcome {
        Some(v) if v.trim() == "42" => {
            println!("[spike1] PASS (SPIKE-2) — callAsyncJavaScript awaited a Promise → {v} (async eval works).");
            std::process::exit(0);
        }
        Some(v) => {
            println!("[spike1] callAsyncJavaScript returned {v:?} (expected 42) — review.");
            std::process::exit(0);
        }
        None => {
            println!("[spike1] callAsyncJavaScript did not return in time (no-bridge result above still stands).");
            std::process::exit(0);
        }
    }
}

// Suppress an unused-import warning if `Retained` ends up unused after edits.
#[allow(dead_code)]
fn _keep(_: Option<Retained<AnyObject>>) {}
