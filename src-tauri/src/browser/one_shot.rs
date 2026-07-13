//! Single-use browser authorizations — the user's "Allow once" (WI-2.1 / R5 / R7a).
//!
//! These live in the DRIVER, not the frontend store, because the driver is the
//! authority. A one-shot held only by the frontend would be checked there and then
//! refused here (the gate demands a standing grant it never receives) — so it would
//! authorize nothing at all. It is minted via `browser_add_one_shot` and consumed
//! by `browser_eval`.
//!
//! A one-shot is bound to the full action it authorizes:
//!   - **tab + generation** give it the committed origin's lifecycle (R7a): it is
//!     valid only while the tab is on the exact page the user approved. A
//!     navigation bumps the generation (and clears the one-shot outright — see
//!     `clear_one_shots_for_tab`), and closing the tab drops it. An approval for
//!     "the page I'm looking at" cannot be spent on a later page.
//!   - **origin + operation + target** stop lateral escalation: an approval for
//!     "click Publish" cannot be spent on "click Delete", a different origin, or a
//!     different operation.
//!
//! Consumption is deliberately not separable from the check: a one-shot authorizes
//! exactly ONE action, so `consume_one_shot` removes it as it answers.
//!
//! @coordinates-with browser/origin_guard.rs — the shared matching rules
//! @coordinates-with browser/registry.rs — the generation the freshness rests on
//! @coordinates-with services/browser/grantSync.ts — mints these from the store

use crate::browser::origin_guard::{canonicalize_origin, origin_matches_pattern, NEVER_AUTOMATED};

/// The element an `act` targets — ARIA role + accessible name. Absent for `read`,
/// which snapshots the whole page rather than one element.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct OneShotTarget {
    pub role: String,
    pub name: String,
}

/// A single-use authorization bound to (tab, generation, origin, operation, target).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OneShot {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub generation: u64,
    #[serde(rename = "originPattern")]
    pub origin_pattern: String,
    pub operation: String,
    #[serde(default)]
    pub target: Option<OneShotTarget>,
}

/// Same element? Both target-less (a read), or both naming the same role + name.
fn same_target(a: Option<&OneShotTarget>, b: Option<&OneShotTarget>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

/// Spend a one-shot authorizing this exact action, if one matches. Removes it and
/// returns true — check and spend are one operation so a one-shot can never be
/// double-consumed.
///
/// Every dimension must match: the tab and its current `generation` (so a
/// navigated-away page grants nothing), the operation, the target element, and the
/// origin (through the same guard as standing grants — never looser). A
/// never-automatable operation is refused even if a one-shot for it somehow exists.
pub fn consume_one_shot(
    shots: &mut Vec<OneShot>,
    tab_id: &str,
    generation: u64,
    target_url: &str,
    operation: &str,
    target: Option<&OneShotTarget>,
) -> bool {
    if NEVER_AUTOMATED.contains(&operation) {
        return false;
    }
    let Some(origin) = canonicalize_origin(target_url) else {
        return false;
    };
    let Some(index) = shots.iter().position(|s| {
        s.tab_id == tab_id
            && s.generation == generation
            && s.operation == operation
            && same_target(s.target.as_ref(), target)
            && origin_matches_pattern(&origin, &s.origin_pattern)
    }) else {
        return false;
    };
    shots.remove(index);
    true
}

/// Drop every one-shot for `tab_id`. Called when the tab starts a new navigation
/// (its committed origin is revoked — R7a) and when it is destroyed, so authority
/// never outlives the page it was granted on.
pub fn clear_one_shots_for_tab(shots: &mut Vec<OneShot>, tab_id: &str) {
    shots.retain(|s| s.tab_id != tab_id);
}

#[cfg(test)]
#[path = "one_shot.test.rs"]
mod tests;
