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
//! Included via `#[path]` from surface_macos.rs to keep both files under the
//! size limit; `super::` there refers to the `imp` module.
//!
//! @coordinates-with browser/recovery.rs — CrashTracker / RecoveryAction
//! @coordinates-with browser/registry.rs — generation bump + Lifecycle transitions
//! @coordinates-with browser/dialogs_macos.rs — parked confirm() completions

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol};
use objc2::{define_class, DefinedClass, MainThreadOnly};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{
    WKFrameInfo, WKNavigation, WKNavigationAction, WKNavigationDelegate, WKUIDelegate, WKWebView,
    WKWebViewConfiguration, WKWindowFeatures,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::browser::recovery::RecoveryAction;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

#[path = "nav_payloads_macos.rs"]
mod payloads;
use payloads::{CrashPayload, DialogPayload, LoadedPayload, NavPayload, PopupPayload};

// The registry/lifecycle half of the delegate (construction, transitions, crash
// recording, reload) — see nav_registry_macos.rs.
#[path = "nav_registry_macos.rs"]
mod registry_bridge;

/// Per-delegate context: which tab it serves and the handle to emit events on.
pub struct NavDelegateIvars {
    tab_id: String,
    app: AppHandle,
}

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

    // SAFETY: the method signatures match WKNavigationDelegate.
    unsafe impl WKNavigationDelegate for NavDelegate {
        // A navigation STARTS: revoke the committed origin immediately (R7a). Until
        // the next commit lands the tab grants nothing, so a redirect chain can
        // never leave the previous page's authority in force while a new origin is
        // loading.
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
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

        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit(&self, web_view: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            let url = current_url(web_view);
            let mut generation = 0;
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                match state.registry.lock() {
                    Ok(mut reg) => {
                        // One bump per commit, and only here — the navigate command
                        // used to bump too, advancing the generation twice for one
                        // navigation (and once for a navigation that never happened).
                        match reg.bump_generation(&ivars.tab_id) {
                            Ok(g) => generation = g,
                            Err(e) => log::warn!(
                                "[browser] generation bump refused for {}: {e:?}",
                                ivars.tab_id
                            ),
                        }
                        if let Err(e) = reg.transition(&ivars.tab_id, Lifecycle::Navigating) {
                            log::warn!(
                                "[browser] commit transition refused for {}: {e:?}",
                                ivars.tab_id
                            );
                        }
                        // The COMMITTED url — the only origin the driver may act on
                        // (R7a). Recorded from the webview itself, never from a caller.
                        if let Err(e) = reg.set_committed_url(&ivars.tab_id, &url) {
                            log::warn!(
                                "[browser] committed-url write refused for {}: {e:?}",
                                ivars.tab_id
                            );
                        }
                    }
                    Err(e) => log::warn!("[browser] registry lock poisoned on commit: {e}"),
                }
            }
            let _ = ivars.app.emit(
                "browser://navigated",
                NavPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    generation,
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
            let _ = ivars.app.emit(
                "browser://loaded",
                LoadedPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    title,
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
            let _ = ivars.app.emit(
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
            let _ = ivars.app.emit(
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
            let _ = ivars.app.emit(
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
            let emitted = ivars.app.emit(
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
            if let Err(e) = emitted {
                log::warn!("[browser] confirm #{id} not delivered ({e}); cancelling");
                super::dialogs::respond(id, false);
            }
        }
    }
);

fn current_url(web_view: &WKWebView) -> String {
    unsafe { web_view.URL() }
        .and_then(|u| u.absoluteString())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn current_title(web_view: &WKWebView) -> String {
    unsafe { web_view.title() }
        .map(|s| s.to_string())
        .unwrap_or_default()
}
