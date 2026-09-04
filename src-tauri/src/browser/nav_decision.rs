//! The pure decisions behind the navigation delegate's policy callbacks (audit
//! 20260903 round 3, #22).
//!
//! `nav_registry_policy_macos.rs` used to decide a top-level navigation candidate
//! inline: policy snapshot, lifecycle interpretation, the ticket a load rides,
//! per-window grants, shared-posture approval and ticket minting, in one 77-line
//! function only a WebKit callback could reach — so none of its branches had a
//! test. This module is that function's DECISION with every input a plain value,
//! so `nav_decision.test.rs` can walk the whole table; the delegate gathers the
//! facts under the registry guard and performs what the decision names. The
//! commit-time re-check (`commit_allowed`) is the same shape one step later.
//!
//! Platform-independent on purpose: the delegate is macOS-only, and a decision
//! that compiles only there is one CI's other legs never run.
//!
//! @coordinates-with browser/nav_registry_policy_macos.rs — gathers the facts, acts on the decision
//! @coordinates-with browser/ai_policy.rs — `validate_ai_navigation_url`, the destination check

use crate::browser::registry::{AutomationMode, Lifecycle};

/// What the delegate knows about a top-level navigation candidate when WebKit asks
/// whether to start the load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NavigationFacts {
    /// The tab's posture; `None` for a tab the registry does not know.
    pub mode: Option<AutomationMode>,
    /// `ai_policy.enabled` — the embedded browser's master switch.
    pub browser_enabled: bool,
    /// The tab's recorded lifecycle; `None` for an unknown tab.
    pub lifecycle: Option<Lifecycle>,
    /// Does the tab hold a navigation ticket (a load already begun)?
    pub has_ticket: bool,
    /// `validate_ai_navigation_url(url, allow_loopback).is_ok()`. Consulted only
    /// for an AI-owned tab: a human's page is never held to the AI destination
    /// policy.
    pub destination_allowed: bool,
    /// `registry.shared_navigation_approved(tab, url)` — the approval the current
    /// navigation was begun with. Consulted only for `AiShared`.
    pub shared_approved: bool,
    /// The owning window's standing `navigate` grant covers `url`. Consulted only
    /// for `AiShared`.
    pub navigate_granted: bool,
}

/// The delegate's next move for a top-level candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    /// Cancel the load.
    Refuse,
    /// Allow it as the continuation of the navigation already in flight (a
    /// redirect hop, or a load WebKit is still starting): it rides the tab's
    /// current ticket and no new one is minted.
    RideCurrentTicket,
    /// Allow it as a NEW navigation: mint a ticket, and for a shared tab record
    /// the destination approval the ticket was begun with.
    BeginNavigation,
}

/// Decide a top-level navigation candidate.
///
/// A load rides the current ticket exactly when the tab is `Navigating` AND holds
/// a ticket — the delegate's old `continuing` / "in flight" split on its `loading`
/// flag collapsed to this one condition, and a navigating tab WITHOUT a ticket (an
/// invariant violation) falls through to a fresh ticket rather than panicking. A
/// shared tab rides on the approval its navigation was begun with or on standing
/// authority; a FRESH shared navigation has only standing authority, because there
/// is no approval dialog at this native seam and MCP one-shots are consumed by the
/// command that began the navigation.
pub fn decide_navigation_action(facts: NavigationFacts) -> NavigationDecision {
    if !facts.browser_enabled {
        return NavigationDecision::Refuse;
    }
    let Some(mode) = facts.mode else {
        return NavigationDecision::Refuse;
    };
    if mode != AutomationMode::Human && !facts.destination_allowed {
        return NavigationDecision::Refuse;
    }
    let shared = mode == AutomationMode::AiShared;
    if facts.lifecycle == Some(Lifecycle::Navigating) && facts.has_ticket {
        if shared && !facts.shared_approved && !facts.navigate_granted {
            return NavigationDecision::Refuse;
        }
        return NavigationDecision::RideCurrentTicket;
    }
    if shared && !facts.navigate_granted {
        return NavigationDecision::Refuse;
    }
    NavigationDecision::BeginNavigation
}

/// What the delegate knows when a navigation COMMITS and the destination is
/// re-checked against the policy that holds now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitFacts {
    pub mode: AutomationMode,
    /// `ai_policy.enabled`.
    pub browser_enabled: bool,
    /// The tab was created under the policy epoch that holds now.
    pub epoch_current: bool,
    /// `validate_ai_navigation_url(url, allow_loopback).is_ok()`; consulted only
    /// for an AI-owned tab.
    pub destination_allowed: bool,
    /// `registry.shared_navigation_approved(tab, url)`; `AiShared` only.
    pub shared_approved: bool,
    /// The owning window grants `navigate` on `url`; `AiShared` only.
    pub navigate_granted: bool,
}

/// May the committed navigation stand? A disabled browser commits nothing — not
/// even a human's page; an AI tab needs the current epoch and an allowed
/// destination; a shared tab additionally needs the approval or standing authority.
pub fn commit_allowed(facts: CommitFacts) -> bool {
    if !facts.browser_enabled {
        return false;
    }
    match facts.mode {
        AutomationMode::Human => true,
        AutomationMode::AiSandbox => facts.epoch_current && facts.destination_allowed,
        AutomationMode::AiShared => {
            facts.epoch_current
                && facts.destination_allowed
                && (facts.shared_approved || facts.navigate_granted)
        }
    }
}

#[cfg(test)]
#[path = "nav_decision.test.rs"]
mod tests;
