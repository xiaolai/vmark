//! WKNavigationDelegate for the embedded browser (WI-1.7 navigation lifecycle +
//! WI-1.8 crash observation). The first objc2 protocol-conforming class in the
//! repo; built with `define_class!` per the objc2 0.6 delegate pattern.
//!
//! **The delegate owns the tab's lifecycle.** Nothing else writes it: the command
//! layer registers a tab and starts a load, and what the load then *does* — commit,
//! finish, fail, die — is known only here. (The commands used to force `Live` after
//! the native call, asserting a page had loaded even when it hadn't.) Each callback
//! documents its own contract below; the registry half lives in
//! nav_registry_macos.rs and the payloads in nav_payloads_macos.rs.
//!
//! The crash callback (`webViewWebContentProcessDidTerminate`) cannot be triggered
//! on demand — WKWebView exposes no crash API — so it ships wired and unit-tested
//! through recovery.rs, but the live delegate hop itself has no automated test.
//!
//! Included via `#[path]` from surface_macos.rs; `super::` refers to the `imp` module.
//!
//! @coordinates-with browser/recovery.rs — CrashTracker / RecoveryAction
//! @coordinates-with browser/registry.rs — generation bump + Lifecycle transitions
//! @coordinates-with browser/dialogs_macos.rs — parked confirm() completions

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{define_class, DefinedClass, MainThreadOnly};
use core::ffi::c_void;
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{
    WKFrameInfo, WKNavigation, WKNavigationAction, WKNavigationDelegate, WKUIDelegate, WKWebView,
    WKWebViewConfiguration, WKWindowFeatures,
};
use tauri::Manager;

use crate::browser::recovery::RecoveryAction;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

#[path = "nav_payloads_macos.rs"]
mod payloads;
use payloads::{CrashPayload, DialogPayload, LoadedPayload, NavPayload, PopupPayload};

#[path = "nav_webview_macos.rs"]
mod webview;
use webview::{current_title, current_url, history_state};

#[path = "nav_emit_macos.rs"]
mod emit;

// The registry/lifecycle half of the delegate (construction, transitions, crash
// recording, reload) — see nav_registry_macos.rs.
#[path = "nav_registry_macos.rs"]
mod registry_bridge;
use registry_bridge::NavDelegateIvars;

// Asserts every selector declared below is REAL — see nav_selectors.test.rs.
#[cfg(test)]
#[path = "nav_selectors.test.rs"]
mod selectors_test;

define_class!(
    // SAFETY:
    // - NSObject has no subclassing requirements.
    // - NavDelegate does not implement Drop.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = NavDelegateIvars]
    pub struct NavDelegate;

    // SAFETY: NSObjectProtocol has no safety requirements.
    unsafe impl NSObjectProtocol for NavDelegate {}

    // KVO on `WKWebView.URL` — the only PUBLIC way to observe a same-document navigation
    // (pushState / replaceState / a fragment jump). Those fire no navigation-delegate
    // callback: the public WKNavigationDelegate protocol has no same-document method at
    // all. See `same_document_navigated` for why this replaced a selector that never fired.
    impl NavDelegate {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe_value(
            &self,
            key_path: Option<&NSString>,
            object: Option<&AnyObject>,
            _change: Option<&AnyObject>,
            _context: *mut c_void,
        ) {
            if key_path.map(|k| k.to_string()).as_deref() != Some(registry_bridge::URL_KEY_PATH) {
                return;
            }
            let Some(object) = object else { return };
            // SAFETY: this observer is registered on exactly one key path of exactly one
            // object — the tab's WKWebView (`observe_url`) — so `object` is that webview.
            let web_view: &WKWebView = unsafe { &*(object as *const AnyObject).cast() };
            self.same_document_navigated(web_view);
        }
    }

    // SAFETY: the method signatures match WKNavigationDelegate.
    unsafe impl WKNavigationDelegate for NavDelegate {
        // A navigation STARTS: revoke the committed origin immediately (R7a). Until
        // the next commit lands the tab grants nothing, so a redirect chain can
        // never leave the previous page's authority in force while a new origin is
        // loading.
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            ivars.redirected.set(false); // a fresh navigation has followed no redirects
            ivars.loading.set(true); // a URL change now belongs to THIS load, not to an SPA
                                         // The outgoing page's dialogs die with it: release its blocked JS now,
                                         // or a stale answer would be routed to a page that no longer exists.
            super::dialogs::drain_for(&ivars.tab_id);
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.clear_committed_url(&ivars.tab_id);
                }
                // R7a: authority lapses the instant the page starts changing. A
                // one-shot the user approved for the outgoing page must not carry
                // over to whatever loads next.
                state.clear_tab_one_shots(&ivars.tab_id);
            }
        }

        // Recorded, not announced: history wants to know how the user SET OFF, and a
        // redirect is something the site did afterwards (WI-S2.2).
        #[unsafe(method(webView:didReceiveServerRedirectForProvisionalNavigation:))]
        fn did_receive_redirect(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            self.ivars().redirected.set(true);
        }
        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit(&self, web_view: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            ivars.loading.set(false); // committed: a URL change after this is same-document
            let url = current_url(web_view);
            let generation = self.commit_navigation(&url);
            let (can_go_back, can_go_forward) = history_state(web_view);
            let _ = self.emit_owned(
                "browser://navigated",
                NavPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    generation,
                    can_go_back,
                    can_go_forward,
                    redirected: ivars.redirected.get(),
                },
            );
        }
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, web_view: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            let url = current_url(web_view);
            let title = current_title(web_view);
            self.set_state(Lifecycle::Live);
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                if let Ok(mut trackers) = state.crash_trackers.lock() {
                    trackers
                        .entry(ivars.tab_id.clone())
                        .or_default()
                        .on_load_success();
                }
            }
            log::debug!("[browser] loaded {} ({title})", ivars.tab_id);
            let (can_go_back, can_go_forward) = history_state(web_view);
            let _ = self.emit_owned(
                "browser://loaded",
                LoadedPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    title,
                    can_go_back,
                    can_go_forward,
                },
            );
        }
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(
            &self,
            _wv: &WKWebView,
            _nav: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.emit_failed(error);
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>, error: &NSError) {
            self.emit_failed(error);
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn process_terminated(&self, web_view: &WKWebView) {
            let ivars = self.ivars();
            // The page is gone; nothing will ever answer its dialogs.
            super::dialogs::drain_for(&ivars.tab_id);
            let action = self.record_crash();
            log::warn!(
                "[browser] content process terminated for {} → {action:?}",
                ivars.tab_id
            );
            // Announce what ACTUALLY happened. `reload()` returns nil when there is
            // nothing to reload; announcing "auto-reload" and then not navigating
            // leaves the frontend waiting on a load event that can never arrive.
            let reloading = action == RecoveryAction::AutoReload && self.try_reload(web_view);
            let _ = self.emit_owned(
                "browser://crashed",
                CrashPayload {
                    tab_id: ivars.tab_id.clone(),
                    action: if reloading { "auto-reload" } else { "manual" },
                },
            );
        }
    }

    // SAFETY: the method signatures match WKUIDelegate.
    unsafe impl WKUIDelegate for NavDelegate {
        // `window.open` / `target=_blank`: return nil to block the popup (WKWebView
        // would otherwise create an untracked child webview outside VMark's tab
        // model) and emit the target so the frontend can open it as a real tab,
        // re-checking origin (R12).
        #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create_web_view(
            &self,
            _wv: &WKWebView,
            _config: &WKWebViewConfiguration,
            action: &WKNavigationAction,
            _features: &WKWindowFeatures,
        ) -> Option<Retained<WKWebView>> {
            let ivars = self.ivars();
            let url = unsafe { action.request() }
                .URL()
                .and_then(|u| u.absoluteString())
                .map(|s| s.to_string())
                .unwrap_or_default();
            log::debug!("[browser] popup blocked for {} → {url}", ivars.tab_id);
            let _ = self.emit_owned(
                "browser://popup",
                PopupPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                },
            );
            None
        }

        // `alert()`: surface the message and acknowledge so the page's JS continues
        // (an unhandled panel hangs the page). `prompt()` stays at WebKit's default
        // for now; `confirm()` is handled below.
        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn run_alert(
            &self,
            _wv: &WKWebView,
            message: &NSString,
            _frame: &WKFrameInfo,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let ivars = self.ivars();
            let msg = message.to_string();
            log::debug!("[browser] alert on {}: {msg}", ivars.tab_id);
            let _ = self.emit_owned(
                "browser://dialog",
                DialogPayload {
                    tab_id: ivars.tab_id.clone(),
                    kind: "alert",
                    message: msg,
                    id: None,
                },
            );
            completion_handler.call(());
        }

        // `confirm()`: park the retained completion + surface an OK/Cancel dialog;
        // `browser_dialog_respond` resumes the page's JS later (see dialogs_macos.rs).
        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn run_confirm(
            &self,
            _wv: &WKWebView,
            message: &NSString,
            _frame: &WKFrameInfo,
            completion_handler: &block2::DynBlock<dyn Fn(objc2::runtime::Bool)>,
        ) {
            let ivars = self.ivars();
            let msg = message.to_string();
            let id = super::dialogs::park_confirm(ivars.tab_id.clone(), completion_handler.copy());
            log::debug!("[browser] confirm on {} (#{id}): {msg}", ivars.tab_id);
            let emitted = self.emit_owned(
                "browser://dialog",
                DialogPayload {
                    tab_id: ivars.tab_id.clone(),
                    kind: "confirm",
                    message: msg,
                    id: Some(id),
                },
            );
            // Parking + emitting is one transaction: a dialog nobody was told about
            // is a dialog nobody can answer, and the page's JS would block on
            // `confirm()` forever. If the event never left, cancel it here.
            if !emitted {
                log::warn!("[browser] confirm #{id} not delivered; cancelling");
                super::dialogs::respond(id, false);
            }
        }
    }
);
