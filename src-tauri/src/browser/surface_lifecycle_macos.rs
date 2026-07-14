//! Native-view lifecycle for the browser surface (WI-S0.10).
//!
//! `evict_existing` and `destroy` both tear a WKWebView out of the view hierarchy, and
//! both are about the same hazard: a native view that outlives the thing that owned it.
//! Split from surface_macos.rs to keep it under the file-size limit; a `#[path]`
//! submodule, so `super::` reaches the parent's WEBVIEWS/DELEGATES registries.

use tauri::AppHandle;

/// Remove any webview already registered under `tab_id` from the view hierarchy.
///
/// Nothing normally hits this — `destroy` runs on unmount. It exists for the rapid
/// switch-away-and-back race (WI-S0.10), where a second `create` for the same tab can
/// land before the first `destroy`. Without it the superseded view is dropped from the
/// map but never removed from its superview: a live page, invisible to us, still
/// painting over the UI, with no handle left to tear it down.
pub(super) fn evict_existing(tab_id: &str) {
    super::WEBVIEWS.with(|m| {
        if let Some(old) = m.borrow_mut().remove(tab_id) {
            log::warn!(
                "[browser] evicting a superseded webview for {tab_id} (create/destroy race)"
            );
            unsafe {
                old.setNavigationDelegate(None);
                old.setUIDelegate(None);
            }
            old.removeFromSuperview();
        }
    });
}

/// Tear down and drop the native webview.
pub fn destroy(app: &AppHandle, tab_id: String) -> Result<(), String> {
    super::on_main(app, move |_mtm| {
        // Release any page JS blocked on a dialog before the webview goes away.
        super::dialogs::drain_for(&tab_id);
        super::WEBVIEWS.with(|m| {
            if let Some(webview) = m.borrow_mut().remove(&tab_id) {
                // Detach the delegate before teardown so no late callback fires
                // against a half-destroyed view.
                unsafe {
                    webview.setNavigationDelegate(None);
                    webview.setUIDelegate(None);
                }
                webview.removeFromSuperview();
            }
        });
        super::DELEGATES.with(|m| {
            m.borrow_mut().remove(&tab_id);
        });
        Ok(())
    })
}
