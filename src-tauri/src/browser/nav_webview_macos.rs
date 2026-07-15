//! Reads off the live `WKWebView` for the nav delegate — current URL, title, and
//! back/forward-list state. Split from nav_delegate_macos.rs to keep it under the
//! file-size limit; a `#[path]` submodule of `nav_delegate`.
//!
//! These are deliberately *reads*, never a mirror: WebKit owns the URL, the title,
//! and the back/forward list, and a redirect, a same-document push, or a `goBack()`
//! all mutate them without any command passing through us. Re-reading at each event
//! is what keeps the chrome honest.

use objc2_web_kit::WKWebView;

pub(super) fn current_url(web_view: &WKWebView) -> String {
    unsafe { web_view.URL() }
        .and_then(|u| u.absoluteString())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

pub(super) fn current_title(web_view: &WKWebView) -> String {
    unsafe { web_view.title() }
        .map(|s| s.to_string())
        .unwrap_or_default()
}

/// The webview's back/forward-list state as `(can_go_back, can_go_forward)` (WI-S1.6).
///
/// The omnibox disables its history controls from these, so a stale mirror would be
/// worse than no state at all — hence the direct read.
pub(super) fn history_state(web_view: &WKWebView) -> (bool, bool) {
    unsafe { (web_view.canGoBack(), web_view.canGoForward()) }
}
