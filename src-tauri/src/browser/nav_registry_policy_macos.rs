//! Policy checks for committed AI navigation URLs.

use crate::browser::ai_policy::validate_ai_navigation_url;
use crate::browser::origin_guard::is_operation_granted;
use crate::browser::registry::{AutomationMode, Lifecycle};
use crate::browser::surface::BrowserSurface;
use objc2::DefinedClass;
use tauri::Manager;

use super::NavDelegate;

impl NavDelegate {
    /// Validate a top-level candidate and associate it with a registry ticket
    /// before WebKit starts the load. Programmatic AI commands already create a
    /// ticket; user/link/history navigations create one here.
    pub(crate) fn prepare_navigation_action(&self, url: &str) -> bool {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return false;
        };
        let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
            return false;
        };
        if !policy.enabled {
            return false;
        }
        let Ok(mut registry) = state.registry.lock() else {
            return false;
        };
        let Some(mode) = registry.automation_mode(&ivars.tab_id) else {
            return false;
        };
        let current_state = registry.state(&ivars.tab_id);
        let current_ticket = registry.navigation_ticket(&ivars.tab_id).cloned();
        let continuing = !ivars.loading.get()
            && current_state == Some(Lifecycle::Navigating)
            && current_ticket.is_some();

        if mode != AutomationMode::Human
            && validate_ai_navigation_url(url, policy.allow_loopback).is_err()
        {
            return false;
        }

        if continuing {
            let ticket = current_ticket.expect("checked above");
            if mode == AutomationMode::AiShared
                && !registry.shared_navigation_approved(&ivars.tab_id, url)
                && !state
                    .grants
                    .lock()
                    .map(|grants| is_operation_granted(url, "navigate", grants.as_slice()))
                    .unwrap_or(false)
            {
                return false;
            }
            self.remember_pending_navigation(ticket.id);
            return true;
        }

        if ivars.loading.get() && current_state == Some(Lifecycle::Navigating) {
            let ticket = current_ticket.expect("a navigating tab has a ticket");
            if mode == AutomationMode::AiShared
                && !registry.shared_navigation_approved(&ivars.tab_id, url)
                && !state
                    .grants
                    .lock()
                    .map(|grants| is_operation_granted(url, "navigate", grants.as_slice()))
                    .unwrap_or(false)
            {
                return false;
            }
            self.remember_pending_navigation(ticket.id);
            return true;
        }

        if mode == AutomationMode::AiShared {
            // A page-initiated shared navigation has no approval dialog surface
            // at this native seam. Standing `navigate` authority is the only
            // safe way to permit it; MCP one-shots are consumed by the command.
            let granted = state
                .grants
                .lock()
                .map(|grants| is_operation_granted(url, "navigate", grants.as_slice()))
                .unwrap_or(false);
            if !granted {
                return false;
            }
        }

        let ticket = match registry.begin_navigation(&ivars.tab_id, url) {
            Ok(ticket) => ticket,
            Err(_) => return false,
        };
        if mode == AutomationMode::AiShared {
            if registry
                .set_shared_navigation_approval(&ivars.tab_id, url)
                .is_err()
            {
                return false;
            }
        }
        self.remember_pending_navigation(ticket.id);
        true
    }
}

pub(super) fn ai_commit_allowed(
    state: &BrowserSurface,
    mode: AutomationMode,
    tab_id: &str,
    url: &str,
) -> bool {
    let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
        return false;
    };
    if !policy.enabled {
        return false;
    }
    let epoch_current = state
        .registry
        .lock()
        .map(|reg| reg.policy_epoch(tab_id) == Some(policy.epoch))
        .unwrap_or(false);
    if mode != AutomationMode::Human && !epoch_current {
        return false;
    }
    match mode {
        AutomationMode::Human => true,
        AutomationMode::AiSandbox => {
            validate_ai_navigation_url(url, policy.allow_loopback).is_ok()
        }
        AutomationMode::AiShared => {
            if validate_ai_navigation_url(url, policy.allow_loopback).is_err() {
                return false;
            }
            let approved = state
                .registry
                .lock()
                .map(|reg| reg.shared_navigation_approved(tab_id, url))
                .unwrap_or(false);
            let grant = state
                .grants
                .lock()
                .map(|grants| is_operation_granted(url, "navigate", &grants))
                .unwrap_or(false);
            approved || grant
        }
    }
}
