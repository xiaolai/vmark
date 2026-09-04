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
//! The decision and the write are each ONE registry guard (audit 20260903 round 3, #21).
//! This used to read the committed URL, mode, epoch and shared approval through four
//! separate locks and then bump-and-record through a fifth; a top-level navigation begun
//! by a command thread in between revokes the committed page, and the late write here put
//! it back — on a tab that was `Navigating`, hence executable — for a page WebKit was
//! already leaving. `same_document_view` reads everything at once, and
//! `commit_same_document` refuses to record unless the ticket it observed is still the
//! one in force.
//!
//! A `#[path]` submodule of nav_registry_macos.rs, adding inherent methods to
//! `NavDelegate`. Split out to keep both files under the file-size limit.
//!
//! @coordinates-with registry_same_document.rs — same_document_view / commit_same_document
//! @coordinates-with ai_policy.rs — same_document_allowed, the pure half of the decision
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
use crate::browser::ai_policy::same_document_allowed;
use crate::browser::nav_api_navigation::{own, Settlement};
use crate::browser::registry::same_document::SameDocumentRefusal;
use crate::browser::surface::BrowserSurface;

/// The one property observed. `WKWebView.URL` is documented KVO-compliant.
pub(in crate::browser) const URL_KEY_PATH: &str = "URL";

impl NavDelegate {
    /// Run an API-initiated navigation call — `loadRequest`, `goBack`, `goForward` —
    /// so the URL change it publishes SYNCHRONOUSLY is not taken for a same-document
    /// navigation, then `pump` the load and settle. The rule and the measured WebKit
    /// facts behind it live in `nav_api_navigation.rs`; this supplies the delegate's
    /// `loading` flag, its start counter, the observer, and the authority revocation.
    /// Returns whether WebKit created a navigation.
    pub(in crate::browser) fn api_navigation(
        &self,
        web_view: &WKWebView,
        start: impl FnOnce() -> bool,
        pump: impl FnOnce(&WKWebView),
    ) -> bool {
        let ivars = self.ivars();
        let starts_before = ivars.starts.get();
        let Some(owned) = own(&ivars.loading, start) else {
            return false; // nowhere to go: nothing changed, nothing will report
        };
        // The view WILL change, whichever kind of move this is. Revoke the tab's
        // one-shots and attachment NOW, under the registry guard — before the pump
        // can run another command against a view that is on its way out — as the
        // observer used to (by accident of the misfire) and the start does later.
        if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
            if let Ok(mut reg) = state.registry.lock() {
                state.clear_tab_authority_in(&mut reg, &ivars.tab_id);
            }
        }
        pump(web_view);
        let saw_start = ivars.starts.get() != starts_before;
        let still_loading = unsafe { web_view.isLoading() };
        match owned.settle(&ivars.loading, saw_start, still_loading) {
            Settlement::CrossDocument | Settlement::Pending => {}
            Settlement::SameDocument { observe_now } => {
                if observe_now {
                    // The history item's URL change arrived while the flag was up;
                    // nothing else will report it. Records the page and expires the
                    // authority granted against the previous view (R7a).
                    self.same_document_navigated(web_view);
                }
            }
        }
        true
    }

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
        // ONE read of everything the decision needs, including the ticket the write
        // below must still find.
        let Some(view) = state
            .registry
            .lock()
            .ok()
            .and_then(|reg| reg.same_document_view(&ivars.tab_id, &url))
        else {
            return; // an unknown tab has no authority to expire
        };
        if view.committed_url.as_deref() == Some(url.as_str()) {
            return; // already recorded — nothing changed, so no authority to expire
        }
        let policy = state.ai_policy.lock().ok().map(|policy| *policy);
        let allowed = policy.is_some_and(|policy| {
            same_document_allowed(
                view.mode,
                &policy,
                view.policy_epoch,
                view.shared_approved,
                &url,
            )
        });
        if !allowed {
            self.emit_policy_failed("AI same-document destination blocked by policy");
            return;
        }
        log::debug!(
            "[browser] same-document navigation on {}: {}",
            ivars.tab_id,
            crate::browser::redact::redact(&url)
        );
        // R7a: the view this tab's authority was granted against is gone. Bump the
        // generation (so any operation stamped with the old one is refused as
        // stale) and record the new committed url — under one guard, and only if
        // no top-level navigation has superseded the page observed above.
        let committed = state.registry.lock().ok().map(|mut reg| {
            reg.commit_same_document(&ivars.tab_id, &url, view.navigation_id.as_deref())
        });
        let generation = match committed {
            Some(Ok(generation)) => generation,
            Some(Err(SameDocumentRefusal::Superseded)) => {
                // A command thread began a navigation after the observation: its own
                // commit records the next page, and its revocation stands.
                log::debug!(
                    "[browser] same-document navigation on {} superseded by a top-level navigation",
                    ivars.tab_id
                );
                return;
            }
            Some(Err(SameDocumentRefusal::NoCommittedPage)) => {
                // No page has committed, so there is no document to have navigated
                // within and no authority to expire — the registry's answer, not an
                // anomaly (a first load's URL change, reported before its commit).
                log::debug!(
                    "[browser] same-document navigation on {} with no committed page; nothing to expire",
                    ivars.tab_id
                );
                return;
            }
            Some(Err(refusal)) => {
                log::warn!(
                    "[browser] same-document commit refused for {}: {refusal:?}",
                    ivars.tab_id
                );
                if refusal == SameDocumentRefusal::GenerationExhausted {
                    // The registry has already dropped the committed page (it
                    // cannot stamp this view apart from the last one); finish the
                    // revocation under the registry guard, so nothing approved for
                    // the replaced view survives it and no reused id is caught in
                    // between (#35).
                    if let Ok(mut reg) = state.registry.lock() {
                        state.clear_tab_authority_in(&mut reg, &ivars.tab_id);
                    }
                }
                return;
            }
            None => {
                log::warn!("[browser] registry lock poisoned on same-document navigation");
                return;
            }
        };
        // R7a: the view the authority was granted against is gone — revoked under
        // the registry guard, never in a gap after it (#35).
        if let Ok(mut reg) = state.registry.lock() {
            state.clear_tab_authority_in(&mut reg, &ivars.tab_id);
        }
        let (can_go_back, can_go_forward) = history_state(web_view);
        let _ = self.emit_owned(
            "browser://navigated",
            NavPayload {
                tab_id: ivars.tab_id.clone(),
                url,
                generation,
                navigation_id: self.current_navigation_id(),
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

#[cfg(test)]
#[path = "nav_api_navigation_native.test.rs"]
mod native_tests;
