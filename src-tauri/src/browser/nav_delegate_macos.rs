//! WKNavigationDelegate for the embedded browser (WI-1.7 navigation lifecycle +
//! WI-1.8 crash observation). The first objc2 protocol-conforming class in the
//! repo; built with `define_class!` per the objc2 0.6 delegate pattern.
//!
//! What it does, per browsed tab:
//!   - **didCommit** — a navigation committed: bump the navigation generation
//!     (R7a / WI-1.2 — stale driver commands issued against the old page are then
//!     rejected) and mark the tab `Navigating`; emit `browser://navigated`.
//!   - **didFinish** — a clean load: mark the tab `Live`, forgive the crash
//!     streak (recovery.rs), and emit `browser://loaded` with url + title.
//!   - **didFail(Provisional)** — emit `browser://load-failed` with the message.
//!   - **webViewWebContentProcessDidTerminate** — the content process died
//!     (WI-1.8): record it in the tab's CrashTracker, mark `Crashed`, emit
//!     `browser://crashed` with the recovery action, and auto-reload while within
//!     the crash budget. (This callback cannot be triggered on demand — WKWebView
//!     exposes no crash API — so it ships wired + unit-tested via recovery.rs, but
//!     the live delegate hop itself is not exercised by an automated test.)
//!
//! Included via `#[path]` from surface_macos.rs to keep both files under the
//! size limit; `super::` there refers to the `imp` module.
//!
//! @coordinates-with browser/recovery.rs — CrashTracker / RecoveryAction
//! @coordinates-with browser/registry.rs — generation bump + Lifecycle transitions

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSError;
use objc2_web_kit::{WKNavigation, WKNavigationDelegate, WKWebView};
use tauri::{AppHandle, Emitter, Manager};

use crate::browser::recovery::RecoveryAction;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

/// Per-delegate context: which tab it serves and the handle to emit events on.
pub struct NavDelegateIvars {
    tab_id: String,
    app: AppHandle,
}

#[derive(serde::Serialize, Clone)]
struct NavPayload {
    #[serde(rename = "tabId")]
    tab_id: String,
    url: String,
}

#[derive(serde::Serialize, Clone)]
struct LoadedPayload {
    #[serde(rename = "tabId")]
    tab_id: String,
    url: String,
    title: String,
}

#[derive(serde::Serialize, Clone)]
struct FailedPayload {
    #[serde(rename = "tabId")]
    tab_id: String,
    message: String,
}

#[derive(serde::Serialize, Clone)]
struct CrashPayload {
    #[serde(rename = "tabId")]
    tab_id: String,
    /// "auto-reload" while within the crash budget, else "manual".
    action: &'static str,
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
        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit(&self, web_view: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            let url = current_url(web_view);
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.bump_generation(&ivars.tab_id);
                    let _ = reg.transition(&ivars.tab_id, Lifecycle::Navigating);
                }
            }
            let _ = ivars.app.emit(
                "browser://navigated",
                NavPayload { tab_id: ivars.tab_id.clone(), url },
            );
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, web_view: &WKWebView, _nav: Option<&WKNavigation>) {
            let ivars = self.ivars();
            let url = current_url(web_view);
            let title = current_title(web_view);
            if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.transition(&ivars.tab_id, Lifecycle::Live);
                }
                if let Ok(mut trackers) = state.crash_trackers.lock() {
                    trackers.entry(ivars.tab_id.clone()).or_default().on_load_success();
                }
            }
            log::debug!("[browser] loaded {} ({title})", ivars.tab_id);
            let _ = ivars.app.emit(
                "browser://loaded",
                LoadedPayload { tab_id: ivars.tab_id.clone(), url, title },
            );
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>, error: &NSError) {
            self.emit_failed(error);
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>, error: &NSError) {
            self.emit_failed(error);
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn process_terminated(&self, web_view: &WKWebView) {
            let ivars = self.ivars();
            let action = if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                let decided = state
                    .crash_trackers
                    .lock()
                    .map(|mut t| t.entry(ivars.tab_id.clone()).or_default().on_crash())
                    .unwrap_or(RecoveryAction::ManualOnly);
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.transition(&ivars.tab_id, Lifecycle::Crashed);
                }
                decided
            } else {
                RecoveryAction::ManualOnly
            };
            log::warn!("[browser] content process terminated for {} → {action:?}", ivars.tab_id);
            let label = match action {
                RecoveryAction::AutoReload => "auto-reload",
                RecoveryAction::ManualOnly => "manual",
            };
            let _ = ivars.app.emit(
                "browser://crashed",
                CrashPayload { tab_id: ivars.tab_id.clone(), action: label },
            );
            if action == RecoveryAction::AutoReload {
                // Reload restarts loading; move back through Creating.
                if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
                    if let Ok(mut reg) = state.registry.lock() {
                        let _ = reg.transition(&ivars.tab_id, Lifecycle::Creating);
                    }
                }
                let _ = unsafe { web_view.reload() };
            }
        }
    }
);

impl NavDelegate {
    /// Build a delegate bound to `tab_id`, emitting on `app`.
    pub fn new(mtm: MainThreadMarker, tab_id: String, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(NavDelegateIvars { tab_id, app });
        // SAFETY: NSObject's init has the standard signature.
        unsafe { msg_send![super(this), init] }
    }

    /// Wrap `self` as a WKNavigationDelegate protocol object for `setNavigationDelegate`.
    pub fn as_protocol(&self) -> &ProtocolObject<dyn WKNavigationDelegate> {
        ProtocolObject::from_ref(self)
    }

    fn emit_failed(&self, error: &NSError) {
        let ivars = self.ivars();
        let message = error.localizedDescription().to_string();
        log::debug!("[browser] load failed for {}: {message}", ivars.tab_id);
        let _ = ivars.app.emit(
            "browser://load-failed",
            FailedPayload { tab_id: ivars.tab_id.clone(), message },
        );
    }
}

fn current_url(web_view: &WKWebView) -> String {
    unsafe { web_view.URL() }
        .and_then(|u| u.absoluteString())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn current_title(web_view: &WKWebView) -> String {
    unsafe { web_view.title() }.map(|s| s.to_string()).unwrap_or_default()
}
