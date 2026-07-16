//! WKNavigationDelegate for the embedded browser. Lifecycle and ticket state live in
//! `nav_registry_macos.rs`; wire payloads live in `nav_payloads_macos.rs`.

use core::ffi::c_void;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{define_class, DefinedClass, MainThreadOnly};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{
    WKFrameInfo, WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKUIDelegate, WKWebView, WKWebViewConfiguration, WKWindowFeatures,
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

#[path = "nav_registry_macos.rs"]
mod registry_bridge;
use registry_bridge::NavDelegateIvars;

#[cfg(test)]
#[path = "nav_selectors.test.rs"]
mod selectors_test;

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = NavDelegateIvars]
    pub struct NavDelegate;

    unsafe impl NSObjectProtocol for NavDelegate {}

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
            let web_view: &WKWebView = unsafe { &*(object as *const AnyObject).cast() };
            self.same_document_navigated(web_view);
        }
    }
    unsafe impl WKNavigationDelegate for NavDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_navigation_policy(
            &self,
            _web_view: &WKWebView,
            navigation_action: &WKNavigationAction,
            decision_handler: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let request = unsafe { navigation_action.request() };
            let url = request.URL()
                .and_then(|url| url.absoluteString())
                .map(|url| url.to_string())
                .unwrap_or_default();
            // Nil target frames are blocked popups; they must not mint navigation tickets.
            let target_frame = unsafe { navigation_action.targetFrame() };
            let main_frame = target_frame
                .as_ref()
                .map(|frame| unsafe { frame.isMainFrame() })
                .unwrap_or(false);
            let allowed = match target_frame.as_ref() {
                Some(_) if main_frame => self.prepare_navigation_action(&url),
                Some(_) => true,
                None => false,
            };
            if !allowed {
                let report_failure = target_frame.is_some() && self
                    .ivars()
                    .app
                    .try_state::<BrowserSurface>()
                    .and_then(|state| {
                        state
                            .registry
                            .lock()
                            .ok()
                            .map(|reg| reg.state(&self.ivars().tab_id) == Some(Lifecycle::Navigating))
                    })
                    .unwrap_or(false);
                if report_failure {
                    self.emit_policy_failed("navigation destination blocked by policy");
                } else {
                    log::debug!(
                        "[browser] navigation policy cancelled for {}: {url}",
                        self.ivars().tab_id
                    );
                }
            }
            decision_handler.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional(&self, _wv: &WKWebView, nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            ivars.redirected.set(false); // a fresh navigation has followed no redirects
            ivars.loading.set(true); // a URL change now belongs to THIS load, not to an SPA
            self.mark_navigation_started(nav);
            // Release any outgoing page dialog before the new load runs.
            super::dialogs::drain_for(&ivars.tab_id);
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.clear_committed_url(&ivars.tab_id);
                }
                state.clear_tab_one_shots(&ivars.tab_id);
                state.clear_tab_attachment(&ivars.tab_id);
            }
        }
        #[unsafe(method(webView:didReceiveServerRedirectForProvisionalNavigation:))]
        fn did_receive_redirect(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            self.ivars().redirected.set(true);
        }
        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit(&self, web_view: &WKWebView, nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            ivars.loading.set(false); // committed: a URL change after this is same-document
            let Some(navigation_id) = self.navigation_id_for(nav) else {
                return;
            };
            if !self.is_current_navigation(&navigation_id) {
                return;
            }
            let url = current_url(web_view);
            let Some(generation) = self.commit_navigation(&url, &navigation_id) else {
                unsafe { web_view.stopLoading() };
                self.emit_policy_failed("AI navigation destination blocked by policy");
                return;
            };
            let (can_go_back, can_go_forward) = history_state(web_view);
            let _ = self.emit_owned(
                "browser://navigated",
                NavPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    generation,
                    navigation_id,
                    can_go_back,
                    can_go_forward,
                    redirected: ivars.redirected.get(),
                },
            );
        }
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, web_view: &WKWebView, nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            let Some(navigation_id) = self.navigation_id_for(nav) else {
                return;
            };
            if !self.is_current_navigation(&navigation_id) {
                return;
            }
            let url = current_url(web_view);
            let title = current_title(web_view);
            self.set_state(Lifecycle::Live);
            self.record_load_success();
            log::debug!("[browser] loaded {} ({title})", ivars.tab_id);
            let (can_go_back, can_go_forward) = history_state(web_view);
            let generation = self.committed_generation();
            let _ = self.emit_owned(
                "browser://loaded",
                LoadedPayload {
                    tab_id: ivars.tab_id.clone(),
                    url,
                    title,
                    generation,
                    navigation_id,
                    can_go_back,
                    can_go_forward,
                },
            );
        }
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(
            &self,
            _wv: &WKWebView,
            nav: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.emit_failed(nav, error);
        }
        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _wv: &WKWebView, nav: Option<&WKNavigation>, error: &NSError) {
            self.emit_failed(nav, error);
        }
        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn process_terminated(&self, web_view: &WKWebView) {
            let ivars = self.ivars();
            super::dialogs::drain_for(&ivars.tab_id);
            let action = self.record_crash();
            log::warn!(
                "[browser] content process terminated for {} → {action:?}",
                ivars.tab_id
            );
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
    unsafe impl WKUIDelegate for NavDelegate {
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
            if !emitted {
                log::warn!("[browser] confirm #{id} not delivered; cancelling");
                super::dialogs::respond(id, false);
            }
        }
    }
);
