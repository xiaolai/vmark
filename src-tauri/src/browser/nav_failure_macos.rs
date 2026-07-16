//! Failure settlement and load-failed event emission for the native delegate.

use objc2::DefinedClass;
use objc2_foundation::NSError;
use objc2_web_kit::WKNavigation;
use tauri::Manager;

use super::super::payloads::FailedPayload;
use super::NavDelegate;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

impl NavDelegate {
    pub(in super::super) fn emit_policy_failed(&self, message: &str) {
        self.ivars().loading.set(false);
        let navigation_id = self.current_navigation_id();
        self.settle_after_failure();
        let _ = self.emit_owned(
            "browser://load-failed",
            FailedPayload {
                tab_id: self.ivars().tab_id.clone(),
                message: message.to_string(),
                navigation_id,
            },
        );
    }

    /// Failed loads leave a live webview idle, but revoke its committed authority.
    fn settle_after_failure(&self) {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return;
        };
        let Ok(mut reg) = state.registry.lock() else {
            return;
        };
        if matches!(
            reg.state(&ivars.tab_id),
            Some(Lifecycle::Creating | Lifecycle::Navigating)
        ) {
            if let Err(e) = reg.transition(&ivars.tab_id, Lifecycle::Live) {
                log::warn!(
                    "[browser] failed-load settle refused for {}: {e:?}",
                    ivars.tab_id
                );
            }
        }
        if let Err(e) = reg.clear_navigation(&ivars.tab_id) {
            log::warn!(
                "[browser] failed-load ticket clear refused for {}: {e:?}",
                ivars.tab_id
            );
        }
    }

    /// Settle the lifecycle, then report the failure to the owning window.
    pub(in super::super) fn emit_failed(&self, navigation: Option<&WKNavigation>, error: &NSError) {
        let ivars = self.ivars();
        let Some(navigation_id) = self.navigation_id_for(navigation) else {
            return;
        };
        if !self.is_current_navigation(&navigation_id) {
            return;
        }
        ivars.loading.set(false);
        let message = error.localizedDescription().to_string();
        log::debug!("[browser] load failed for {}: {message}", ivars.tab_id);
        self.settle_after_failure();
        let _ = self.emit_owned(
            "browser://load-failed",
            FailedPayload {
                tab_id: ivars.tab_id.clone(),
                message,
                navigation_id,
            },
        );
    }
}
