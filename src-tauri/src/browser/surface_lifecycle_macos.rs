//! Native-view lifecycle for the browser surface (WI-S0.10 / WI-S0.11).
//!
//! `evict_existing` and `destroy` both tear a WKWebView out of the view hierarchy, and
//! both are about the same hazard: a native view that outlives the thing that owned it.
//! Split from surface_macos.rs to keep it under the file-size limit; a `#[path]`
//! submodule, so `super::` reaches the parent's WEBVIEWS/DELEGATES registries.
//!
//! **The pairing invariant.** A tab is in `WEBVIEWS` if and only if it is in `DELEGATES`,
//! and `create` registers the two together before anything can pump the run loop. That is
//! not tidiness — teardown depends on it. Since WI-S0.11 the delegate is a **KVO observer**
//! on its webview's `URL`, and the only way to unregister an observer is through the object
//! being observed. So `detach` must find the webview to reach the delegate's observation,
//! and the delegate may only be dropped afterwards.
//!
//! Break the invariant and the failure is not a leak, it is a crash: `create` used to fill
//! `WEBVIEWS` only *after* `drive_load`, which **pumps the main run loop** and therefore
//! runs arbitrary reentrant main-thread work — including a `destroy` for this very tab.
//! That destroy found `DELEGATES` populated and `WEBVIEWS` empty, so it had nothing to
//! unobserve through, skipped the unobserve, and dropped the delegate anyway — leaving a
//! KVO observer dangling on a webview that was about to go live. The next URL change would
//! message a freed object. (Audit verification round 2, finding 11.)

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
            detach(&old, tab_id);
            old.removeFromSuperview();
        }
    });
    // Drop the old delegate only after `detach` has unobserved it above.
    super::DELEGATES.with(|m| {
        m.borrow_mut().remove(tab_id);
    });
}

/// Detach every reference WebKit holds to the tab's delegate, in the one order that is
/// safe: unobserve `URL` FIRST.
///
/// KVO is not forgiving here. An observee deallocated with observers still attached raises
/// ("was deallocated while key value observers were still registered with it"), and a
/// notification delivered to a freed observer is a use-after-free. The delegate is only
/// kept alive by `DELEGATES`, so it must stop observing before either side is dropped —
/// which is why both teardown paths funnel through this.
fn detach(webview: &objc2_web_kit::WKWebView, tab_id: &str) {
    super::DELEGATES.with(|m| {
        if let Some(delegate) = m.borrow().get(tab_id) {
            delegate.unobserve_url(webview);
        } else {
            // Cannot happen: `create` registers DELEGATES and WEBVIEWS together, before
            // anything can pump the run loop, so a webview always has its delegate. If it
            // ever does, the delegate was dropped while still observing this webview and we
            // are one URL change away from messaging a freed object — say so.
            log::error!(
                "[browser] {tab_id}: webview with no delegate — a KVO observer may be dangling"
            );
        }
    });
    // Then the delegate itself, so no late callback fires against a half-destroyed view.
    unsafe {
        webview.setNavigationDelegate(None);
        webview.setUIDelegate(None);
    }
}

/// Tear down and drop the native webview.
pub fn destroy(app: &AppHandle, tab_id: String) -> Result<(), String> {
    super::on_main(app, move |_mtm| {
        // Release any page JS blocked on a dialog before the webview goes away.
        super::dialogs::drain_for(&tab_id);
        super::WEBVIEWS.with(|m| {
            if let Some(webview) = m.borrow_mut().remove(&tab_id) {
                detach(&webview, &tab_id);
                webview.removeFromSuperview();
            }
        });
        // Only now may the delegate go: `detach` has already unobserved it.
        super::DELEGATES.with(|m| {
            m.borrow_mut().remove(&tab_id);
        });
        Ok(())
    })
}
