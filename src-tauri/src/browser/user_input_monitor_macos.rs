//! Native user-input takeover signal (WI-NB5.2).
//!
//! React cannot see input inside a browser tab: the WKWebView is a native
//! SIBLING view painted above the DOM placeholder, so a click on the page never
//! reaches the app webview's event system. This module is the missing sense —
//! an app-local `NSEvent` monitor that observes (never consumes) mouse-down /
//! key-down / scroll events, resolves whether they landed in a live browser
//! webview, and emits `browser://user-input {tabId}`. The webview side
//! (`browserLeaseWiring.ts`) reclaims the automation lease when — and only
//! when — the AI holds that tab; ordinary browsing input is a no-op there, so
//! the emission itself carries no policy.
//!
//! STATIC EXCEPTION (rule 50, WI-20): the installed-once guard and the leaked
//! monitor are process-global by nature — AppKit's local event monitor is one
//! hook for the whole app, is never removed for the process lifetime, and must
//! survive every managed-state teardown. This is the sanctioned "no narrower
//! owner exists" case, stated here at the declaration.
//!
//! While an approval dialog (or any overlay) is up, the occlusion policy hides
//! the native browser views — a hidden view resolves to no tab here, so
//! clicking "Allow" in a prompt can never read as a page takeover that would
//! cancel the very run awaiting the approval.

use std::ptr::NonNull;
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
use tauri::{AppHandle, Emitter};

static INSTALLED: OnceLock<()> = OnceLock::new();

/// Install the process-wide monitor, once. Main thread only (enforced by the
/// caller holding a `MainThreadMarker`).
pub(super) fn ensure_installed(app: &AppHandle, mtm: MainThreadMarker) {
    let app = app.clone();
    INSTALLED.get_or_init(move || {
        install(app, mtm);
    });
}

fn install(app: AppHandle, mtm: MainThreadMarker) {
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::RightMouseDown
        | NSEventMask::OtherMouseDown
        | NSEventMask::KeyDown
        | NSEventMask::ScrollWheel;
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // Observe only: the event is returned unchanged whatever happens here.
        let ev = unsafe { event.as_ref() };
        if let Some(tab_id) = resolve(ev, mtm) {
            // Broadcast: only the window owning the tab has lease state for it,
            // every other webview's wiring no-ops. The payload is just an id.
            let _ = app.emit(
                "browser://user-input",
                serde_json::json!({ "tabId": tab_id }),
            );
        }
        event.as_ptr()
    });
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
    // Deliberately leaked — see the module header's static exception.
    std::mem::forget(monitor);
}

/// Which live browser webview (if any) this event addresses. Mouse/scroll
/// events resolve by geometry (the point falls inside a visible browser view);
/// key events resolve by the first responder chain (keystrokes go to focus,
/// not to a location).
fn resolve(ev: &NSEvent, mtm: MainThreadMarker) -> Option<String> {
    let window = ev.window(mtm)?;
    if ev.r#type() == NSEventType::KeyDown {
        let responder = window.firstResponder()?;
        return super::tab_id_for_responder(&responder);
    }
    let point = ev.locationInWindow();
    super::tab_id_at_window_point(&window, point)
}
