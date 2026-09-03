//! Policy checks for AI navigation URLs at the native seam: top-level candidates
//! (`prepare_navigation_action`), subframe loads (`subframe_load_allowed`, audit
//! 20260903 P-01) and the commit-time re-check (`ai_commit_allowed`).
//!
//! Standing `navigate` authority is read from the grants of the WINDOW that owns
//! the tab (audit 20260903 A-03), through `BrowserSurface::is_granted_in_window`,
//! with the registry guard held in the established registry → grants order.

use crate::browser::ai_policy::{self, validate_ai_navigation_url};
use crate::browser::registry::{AutomationMode, Lifecycle};
use crate::browser::surface::BrowserSurface;
use objc2::DefinedClass;
use tauri::Manager;

use super::NavDelegate;

impl NavDelegate {
    /// Is this tab mid-navigation per the registry? Decides whether a refused
    /// main-frame candidate is reported as a failed load or merely logged.
    pub(crate) fn is_navigating(&self) -> bool {
        let ivars = self.ivars();
        ivars
            .app
            .try_state::<BrowserSurface>()
            .and_then(|state| {
                state
                    .registry
                    .lock()
                    .ok()
                    .map(|reg| reg.state(&ivars.tab_id) == Some(Lifecycle::Navigating))
            })
            .unwrap_or(false)
    }

    /// May a SUBFRAME of this tab load `url`? An AI-owned tab runs the same
    /// destination check as its main frame; a human tab is untouched. No ticket is
    /// minted and nothing is emitted either way — the pure decision is
    /// `ai_policy::subframe_load_allowed`, tested there.
    pub(crate) fn subframe_load_allowed(&self, url: &str) -> bool {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return false;
        };
        let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
            return false;
        };
        let Some(mode) = state
            .registry
            .lock()
            .ok()
            .and_then(|reg| reg.automation_mode(&ivars.tab_id))
        else {
            return false;
        };
        ai_policy::subframe_load_allowed(mode, &policy, url)
    }

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

        // Standing `navigate` authority: the owning window's grants, nobody else's.
        let navigate_granted =
            || state.is_granted_in_window(registry.window_of(&ivars.tab_id), url, "navigate");

        // A load that already holds a ticket — the continuation of the current
        // navigation, or a navigating tab whose load is in flight — rides that
        // ticket: shared posture still needs the approval or standing authority.
        // One branch for both, matched safely: a navigating tab without a ticket
        // is an invariant violation and falls through to a fresh ticket rather
        // than panicking on `expect`.
        let riding_ticket = continuing || (ivars.loading.get() && current_state == Some(Lifecycle::Navigating));
        if riding_ticket {
            if let Some(ticket) = current_ticket {
                if mode == AutomationMode::AiShared
                    && !registry.shared_navigation_approved(&ivars.tab_id, url)
                    && !navigate_granted()
                {
                    return false;
                }
                self.remember_pending_navigation(ticket.id);
                return true;
            }
        }

        if mode == AutomationMode::AiShared && !navigate_granted() {
            // A page-initiated shared navigation has no approval dialog surface
            // at this native seam. Standing `navigate` authority is the only
            // safe way to permit it; MCP one-shots are consumed by the command.
            return false;
        }

        let ticket = match registry.begin_navigation(&ivars.tab_id, url) {
            Ok(ticket) => ticket,
            Err(_) => return false,
        };
        if mode == AutomationMode::AiShared
            && registry
                .set_shared_navigation_approval(&ivars.tab_id, url)
                .is_err()
        {
            return false;
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
        AutomationMode::AiSandbox => validate_ai_navigation_url(url, policy.allow_loopback).is_ok(),
        AutomationMode::AiShared => {
            if validate_ai_navigation_url(url, policy.allow_loopback).is_err() {
                return false;
            }
            let (approved, window) = match state.registry.lock() {
                Ok(reg) => (
                    reg.shared_navigation_approved(tab_id, url),
                    reg.window_of(tab_id).map(str::to_owned),
                ),
                Err(_) => return false,
            };
            approved || state.is_granted_in_window(window.as_deref(), url, "navigate")
        }
    }
}
