//! Same-document navigation detection, via KVO on `WKWebView.URL`.
//!
//! **There is no delegate callback for this.** `pushState`, `replaceState`, a
//! `history.back()` within the document and a fragment jump all change the page the user
//! is looking at without starting a navigation — and the public `WKNavigationDelegate`
//! protocol has no same-document method at all. (WebKit's own is the private three-part
//! `_webView:navigation:didSameDocumentNavigation:`, which is SPI.)
//!
//! An earlier fix declared `webView:didSameDocumentNavigation:` and believed it done.
//! That is not a real selector: `define_class!` registers whatever method name it is
//! given, the compiler is satisfied, and the runtime never calls it. It shipped as a
//! security control that did nothing. `URL` is documented KVO-compliant, so this fires.
//!
//! Why it is a security control: an SPA can rewrite its entire DOM without changing
//! origin, so the origin guard still passes — while the *element* the user approved
//! becomes a different button. "Click Publish", approved against one view, spent against
//! another. Authority must lapse with the view it was granted against, not merely with
//! the document (R7a).
//!
//! A `#[path]` submodule of nav_registry_macos.rs, adding inherent methods to
//! `NavDelegate`. Split out to keep both files under the file-size limit.
//!
//! @coordinates-with nav_registry_macos.rs — expire_authority (the R7a half)
//! @coordinates-with nav_delegate_macos.rs — observeValueForKeyPath: dispatches here

use objc2::DefinedClass;
use objc2_foundation::{
    NSKeyValueObservingOptions, NSObjectNSKeyValueObserverRegistration, NSString,
};
use objc2_web_kit::WKWebView;
use tauri::Manager;

use super::super::payloads::NavPayload;
use super::super::webview::{current_url, history_state};
use super::super::NavDelegate;
use crate::browser::surface::BrowserSurface;

/// The one property observed. `WKWebView.URL` is documented KVO-compliant.
pub(in crate::browser) const URL_KEY_PATH: &str = "URL";

impl NavDelegate {
    /// A same-document navigation happened. Called from the `URL` KVO observer.
    ///
    /// Ignores the `URL` change that belongs to a full load — that one is `did_commit`'s,
    /// and it expires authority itself — and a notification for a URL already committed.
    /// So whichever order WebKit chooses to update the property and call the delegate in,
    /// exactly one of the two paths expires the tab's authority, and neither double-bumps
    /// the generation under a one-shot the user just approved for the page in front of them.
    pub(in crate::browser) fn same_document_navigated(&self, web_view: &WKWebView) {
        let ivars = self.ivars();
        if ivars.loading.get() {
            return; // a full navigation owns this URL change; did_commit will handle it
        }
        let url = current_url(web_view);
        if url.is_empty() {
            return;
        }
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return;
        };
        let committed = state
            .registry
            .lock()
            .ok()
            .and_then(|reg| reg.committed_url(&ivars.tab_id).map(str::to_owned));
        if committed.as_deref() == Some(url.as_str()) {
            return; // already recorded — nothing changed, so no authority to expire
        }
        log::debug!(
            "[browser] same-document navigation on {}: {url}",
            ivars.tab_id
        );
        let generation = self.expire_authority(Some(&url));
        let (can_go_back, can_go_forward) = history_state(web_view);
        let _ = self.emit_owned(
            "browser://navigated",
            NavPayload {
                tab_id: ivars.tab_id.clone(),
                url,
                generation,
                can_go_back,
                can_go_forward,
                redirected: false,
            },
        );
    }

    /// Start observing `URL` on the tab's webview.
    ///
    /// Paired with `unobserve_url`, and the pairing is not optional: KVO raises when an
    /// observee is deallocated with observers still registered, and delivering a
    /// notification to a freed observer is a use-after-free. The delegate is kept alive
    /// only by `DELEGATES`, so every teardown path — `destroy` and the create/destroy-race
    /// `evict_existing` — must unobserve before either side is dropped.
    pub fn observe_url(&self, web_view: &WKWebView) {
        // SAFETY: `self` is a valid observer for the lifetime of the observation (see
        // above), and the context pointer is null, which is permitted.
        unsafe {
            web_view.addObserver_forKeyPath_options_context(
                self,
                &NSString::from_str(URL_KEY_PATH),
                NSKeyValueObservingOptions::New,
                std::ptr::null_mut(),
            );
        }
    }

    /// Stop observing `URL`. Must run before either the webview or this delegate is dropped.
    pub fn unobserve_url(&self, web_view: &WKWebView) {
        // SAFETY: removes exactly the registration `observe_url` added.
        unsafe {
            web_view.removeObserver_forKeyPath(self, &NSString::from_str(URL_KEY_PATH));
        }
    }
}
