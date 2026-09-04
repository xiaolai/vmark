//! Policy checks for AI navigation URLs at the native seam: top-level candidates
//! (`prepare_navigation_action`), subframe loads (`subframe_load_allowed`, audit
//! 20260903 P-01) and the commit-time re-check (`ai_commit_allowed`).
//!
//! The DECISIONS live in `nav_decision.rs`, platform-independent and table-tested
//! (round 3, #22); this file gathers each decision's facts under the registry guard
//! and performs what it names — minting a ticket, recording a shared approval,
//! remembering the ticket the load rides.
//!
//! Standing `navigate` authority is read from the grants of the WINDOW that owns
//! the tab (audit 20260903 A-03), through `BrowserSurface::is_granted_in_window`,
//! with the registry guard held in the established registry → grants order.

use crate::browser::ai_policy::{self, validate_ai_navigation_url};
use crate::browser::nav_decision::{
    commit_allowed, decide_navigation_action, CommitFacts, NavigationDecision, NavigationFacts,
};
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
    /// ticket; user/link/history navigations create one here. The decision is
    /// `nav_decision::decide_navigation_action`; this gathers its facts with the
    /// registry guard held, so the state it decides on is the state it acts on.
    pub(crate) fn prepare_navigation_action(&self, url: &str) -> bool {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return false;
        };
        let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
            return false;
        };
        let Ok(mut registry) = state.registry.lock() else {
            return false;
        };
        let tab_id = ivars.tab_id.as_str();
        let mode = registry.automation_mode(tab_id);
        let shared = mode == Some(AutomationMode::AiShared);
        let facts = NavigationFacts {
            mode,
            browser_enabled: policy.enabled,
            lifecycle: registry.state(tab_id),
            has_ticket: registry.navigation_ticket(tab_id).is_some(),
            destination_allowed: mode == Some(AutomationMode::Human)
                || validate_ai_navigation_url(url, policy.allow_loopback).is_ok(),
            // Only a shared tab consults either; the grants are the owning window's.
            shared_approved: shared && registry.shared_navigation_approved(tab_id, url),
            navigate_granted: shared
                && state.is_granted_in_window(registry.window_of(tab_id), url, "navigate"),
        };
        match decide_navigation_action(facts) {
            NavigationDecision::Refuse => false,
            NavigationDecision::RideCurrentTicket => {
                // `has_ticket` held under this same guard, so the ticket is here.
                let Some(ticket) = registry.navigation_ticket(tab_id) else {
                    return false;
                };
                self.remember_pending_navigation(ticket.id.clone());
                true
            }
            NavigationDecision::BeginNavigation => {
                let Ok(ticket) = registry.begin_navigation(tab_id, url) else {
                    return false;
                };
                if shared
                    && registry
                        .set_shared_navigation_approval(tab_id, url)
                        .is_err()
                {
                    return false;
                }
                self.remember_pending_navigation(ticket.id);
                true
            }
        }
    }
}

/// The commit-time re-check: gather `nav_decision::CommitFacts` and decide.
pub(super) fn ai_commit_allowed(
    state: &BrowserSurface,
    mode: AutomationMode,
    tab_id: &str,
    url: &str,
) -> bool {
    let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
        return false;
    };
    let Ok(reg) = state.registry.lock() else {
        return false;
    };
    let shared = mode == AutomationMode::AiShared;
    commit_allowed(CommitFacts {
        mode,
        browser_enabled: policy.enabled,
        epoch_current: reg.policy_epoch(tab_id) == Some(policy.epoch),
        destination_allowed: mode == AutomationMode::Human
            || validate_ai_navigation_url(url, policy.allow_loopback).is_ok(),
        shared_approved: shared && reg.shared_navigation_approved(tab_id, url),
        navigate_granted: shared
            && state.is_granted_in_window(reg.window_of(tab_id), url, "navigate"),
    })
}
