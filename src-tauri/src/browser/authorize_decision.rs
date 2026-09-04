//! The immutable half of the driver gate (audit 20260903 round 3, #10).
//!
//! `decide` reads the registry, the policy snapshot and the owning window's
//! grants and builds a [`Decision`]: what the tab is, which page it is on, and
//! whether standing authority already covers the operation. It spends NOTHING and
//! takes NO lock — the caller (`authorize.rs`) holds the registry guard and hands
//! in the grants it read under it, so the same function is exercised by the
//! command path and by tests that build a bare `BrowserRegistry`. Every refusal
//! that needs no spend to be known is raised here, in the order the gate has
//! always raised them; `authorize_spend.rs` is the other half.
//!
//! A `#[path]` child of `authorize.rs`.
//!
//! @coordinates-with browser/authorize.rs — the composition and the lock order
//! @coordinates-with browser/authorize_spend.rs — what a decision is spent on
//! @coordinates-with browser/refusals.rs — the refusals raised here
//! @coordinates-with browser/origin_guard.rs — the per-operation decision

use std::collections::HashMap;

use crate::browser::ai_guards::{require_current_epoch, tab_not_found};
use crate::browser::ai_policy::AiBrowserPolicy;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::refusals::{
    attachment_required, no_committed_page, profile_origin_confined, stale_command,
};
use crate::browser::registry::{AutomationMode, BrowserRegistry};
use crate::browser::surface::grants_of;
use crate::command_error::CommandError;

/// Everything the gate decided before spending anything. Immutable: built under
/// the registry guard and handed to `spend`, which runs under the same guard, so
/// no registry mutation can sit between the two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Decision {
    pub(super) mode: AutomationMode,
    /// The committed top-level URL (R7a) — the ONLY origin authority is measured
    /// against, read from the registry and never from the caller.
    pub(super) committed: String,
    /// Standing authority — a grant of the owning window, or the mode's own read
    /// right — already covers the operation. When `false`, only a one-shot spent
    /// under the lock can authorize it.
    pub(super) allowed: bool,
}

/// Build the decision for `operation` on `tab_id` at `generation`. `attached` is
/// the caller's PEEK at the human attachment; `spend` re-verifies it under the
/// attachments lock before consuming anything.
pub(super) fn decide(
    reg: &BrowserRegistry,
    policy: &AiBrowserPolicy,
    grants: &HashMap<String, Vec<StandingGrant>>,
    attached: bool,
    tab_id: &str,
    generation: u64,
    operation: &str,
) -> Result<Decision, CommandError> {
    // 1. Freshness: the generation matches and the tab is executable. Closes the
    //    TOCTOU where a page navigates between approval and command.
    if !reg.is_command_fresh(tab_id, generation) {
        return Err(stale_command(tab_id, "since this operation was authorized"));
    }
    // 2. A committed page (R7a): a provisional navigation grants nothing.
    let committed = reg
        .committed_url(tab_id)
        .ok_or_else(|| no_committed_page(tab_id))?;
    let mode = reg.automation_mode(tab_id).ok_or_else(tab_not_found)?;
    if mode != AutomationMode::Human {
        require_current_epoch(reg.policy_epoch(tab_id), policy.epoch)?;
    }
    let shared_origin_approved =
        mode == AutomationMode::AiShared && reg.shared_navigation_approved(tab_id, committed);
    // A profile-backed sandbox tab reads only its approved origin; an ordinary
    // sandbox tab reads unconfined. The registry is the origin authority (WI-P6.1 H1).
    let sandbox_read_allowed = match mode {
        AutomationMode::AiSandbox => reg.profile_read_allowed(tab_id, committed),
        _ => true,
    };
    // 3. Standing authority is the WINDOW's (audit 20260903 A-03): the slice read is
    //    the one the window that owns this tab synced, per the registry.
    let allowed = origin_guard::is_driver_operation_allowed_for_mode(
        committed,
        operation,
        grants_of(grants, reg.window_of(tab_id)),
        mode,
        attached,
        shared_origin_approved,
        sandbox_read_allowed,
    );
    // A profile-backed tab that has left its approved origin is HARD-denied a read
    // (screenshot authorizes as `read`): not even a one-shot may rescue it — the
    // page is loaded with the profile's real login (WI-P6.1 H1, re-verify round 2).
    if operation == "read" && mode == AutomationMode::AiSandbox && !sandbox_read_allowed {
        return Err(profile_origin_confined());
    }
    // A human tab requires an ephemeral attachment for EVERY operation, on top of
    // any grant or one-shot: a grant authorizes the operation on the origin, it is
    // never the per-view human consent (Audit, High).
    if mode == AutomationMode::Human && !attached {
        return Err(attachment_required());
    }
    Ok(Decision {
        mode,
        committed: committed.to_string(),
        allowed,
    })
}

#[cfg(test)]
#[path = "authorize_decision.test.rs"]
mod tests;
