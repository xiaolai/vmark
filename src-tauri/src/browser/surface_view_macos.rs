//! View/URL helpers for the macOS surface — resolving the parent NSView a browsed
//! webview attaches to, and building an NSURL. Split from surface_macos.rs to keep
//! it under the size limit; `super::` refers to that module (which is `imp` under
//! surface.rs). Pure objc2/Tauri glue — no thread-local state.

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSView, NSWindow};
use objc2_foundation::{NSString, NSURL};
use tauri::AppHandle;

/// The content view of the SPECIFIC Tauri window `window_label` names — the parent
/// for our native subview.
///
/// Resolving the exact window (via Tauri's own handle) rather than `keyWindow()`
/// is what makes a browser tab land in the window it belongs to: with two windows
/// open, the key one is whichever the user last clicked, not necessarily the one
/// that owns the tab. Falls back to the key/first window only when the label can't
/// be resolved (a window torn down mid-create), so a stray tab never silently
/// attaches to the wrong window without that being the explicit fallback.
pub(super) fn content_view(
    app: &AppHandle,
    window_label: &str,
    mtm: MainThreadMarker,
) -> Result<Retained<NSView>, String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(ptr) = win.ns_window() {
            // SAFETY: Tauri owns the NSWindow; we borrow it on the main thread
            // (we are inside on_main) only to read its content view. The pointer
            // is non-null when ns_window() succeeds.
            let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
            return ns_window
                .contentView()
                .ok_or_else(|| format!("window '{window_label}' has no contentView"));
        }
    }
    // Fallback: the labelled window is gone. Better a visible attach to the key
    // window than a silent failure — but this is the exception, not the rule.
    let ns_app = NSApplication::sharedApplication(mtm);
    ns_app
        .keyWindow()
        .or_else(|| ns_app.windows().firstObject())
        .ok_or_else(|| "no key window".to_string())?
        .contentView()
        .ok_or_else(|| "no contentView".to_string())
}

pub(super) fn ns_url(url: &str) -> Result<Retained<NSURL>, String> {
    NSURL::URLWithString(&NSString::from_str(url)).ok_or_else(|| format!("invalid URL: {url}"))
}
