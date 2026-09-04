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
//!   - **payload hash** (for `style`/`eval`, which run a caller-supplied script,
//!     and for `type`/`key`/`scroll`, whose built script embeds the text, key or
//!     delta): the one-shot binds a hash of the exact script the user approved, so
//!     an "Allow once" for `return document.title` cannot be spent on a substituted
//!     `steal-the-session` retry — the AI chooses what it re-sends, and without
//!     this the approved-A-runs-B escalation is open. (Security review P5, High #1;
//!     audit 20260903 A-05 for the act operations.)
//!
//! Consumption is deliberately not separable from the check: a one-shot authorizes
//! exactly ONE action, so `consume_one_shot` removes it as it answers.
//!
//! @coordinates-with browser/origin_guard.rs — the shared matching rules
//! @coordinates-with browser/registry.rs — the generation the freshness rests on
//! @coordinates-with services/browser/grantSync.ts — mints these from the store

use crate::browser::operation::is_known_operation;
use crate::browser::origin_guard::{canonicalize_origin, origin_matches_pattern, NEVER_AUTOMATED};

/// The element an `act` targets — ARIA role + accessible name. Absent for `read`,
/// which snapshots the whole page rather than one element.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct OneShotTarget {
    pub role: String,
    pub name: String,
}

/// A single-use authorization bound to (tab, generation, origin, operation, target,
/// payload_hash). `payload_hash` is `Some` only for the payload-binding operations
/// (`operation_binds_payload`) and is a hex SHA-256 of the exact script.
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
    /// Hex SHA-256 of the exact script this one-shot authorizes — `Some` for the
    /// payload-binding operations, `None` otherwise. Binds the approval to the
    /// payload so an approved-A cannot be spent on a substituted-B. (Security
    /// review P5, High #1.)
    #[serde(default)]
    pub payload_hash: Option<String>,
}

impl OneShot {
    /// Does `other` authorize exactly the same action — the same tab, generation,
    /// origin pattern, operation, target and payload?
    ///
    /// Minting is idempotent on this (audit 20260903 A-04): the frontend mints one
    /// approval through two paths, and a second identical entry would be a second
    /// authorization for an action the user approved once.
    pub fn same_binding(&self, other: &OneShot) -> bool {
        self.origin_pattern == other.origin_pattern
            && self.binds_action(
                &other.tab_id,
                other.generation,
                &other.operation,
                other.target.as_ref(),
                other.payload_hash.as_deref(),
            )
    }

    /// Does this one-shot describe exactly this action — same tab, generation,
    /// operation, target element and payload? The origin is compared by the
    /// caller, because the two callers compare it differently: `same_binding`
    /// pattern-to-pattern, `consume_one_shot` a URL against the pattern. One
    /// definition of "the same action" for both, so they cannot drift.
    pub fn binds_action(
        &self,
        tab_id: &str,
        generation: u64,
        operation: &str,
        target: Option<&OneShotTarget>,
        payload_hash: Option<&str>,
    ) -> bool {
        self.tab_id == tab_id
            && self.generation == generation
            && self.operation == operation
            && same_target(self.target.as_ref(), target)
            // The payload must match exactly: a `style`/`eval` approval binds the
            // script's hash, and a substituted retry (approved-A, run-B) is refused.
            // Both `None` for a target-only op leaves this a no-op. (Sec review P5.)
            && self.payload_hash.as_deref() == payload_hash
    }
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
    // Hex SHA-256 of the exact script (for `style`/`eval`), or `None`. Must match the
    // stored one-shot's `payload_hash` — an approval for script A cannot be spent on a
    // substituted script B. Both `None` for operations that carry no script.
    payload_hash: Option<&str>,
) -> bool {
    // The vocabulary is CLOSED, and it has to be closed here too. The standing-grant path
    // (`is_driver_operation_allowed`) already refuses an unknown operation; this one only
    // refused a never-automatable one, so an operation outside the set could be minted and
    // then spent through the one-shot route — precisely the "opaque permission" that
    // operation.rs promises cannot exist. One route enforcing it is not enforcement.
    // (Audit, Medium.)
    if !is_known_operation(operation) || NEVER_AUTOMATED.contains(&operation) {
        return false;
    }
    let Some(origin) = canonicalize_origin(target_url) else {
        return false;
    };
    let Some(index) = shots.iter().position(|s| {
        s.binds_action(tab_id, generation, operation, target, payload_hash)
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
/// Withdraw every unspent one-shot with exactly this identity — tab, generation,
/// origin pattern, operation, target AND payload hash, the same binding
/// `same_binding` matches on — the mint that a cancelled workflow run confirmed
/// AFTER the run was gone (round 3, #124). Returns how many were removed. The
/// payload hash is part of the identity on purpose: revoking one payload-bound
/// mint must not take an unrelated one-shot for the same target with it.
pub fn revoke_one_shot(
    shots: &mut Vec<OneShot>,
    tab_id: &str,
    generation: u64,
    origin_pattern: &str,
    operation: &str,
    target: Option<&OneShotTarget>,
    payload_hash: Option<&str>,
) -> usize {
    let before = shots.len();
    shots.retain(|s| {
        !(s.tab_id == tab_id
            && s.generation == generation
            && s.origin_pattern == origin_pattern
            && s.operation == operation
            && s.target.as_ref().map(|t| (&t.role, &t.name)) == target.map(|t| (&t.role, &t.name))
            && s.payload_hash.as_deref() == payload_hash)
    });
    before - shots.len()
}

pub fn clear_one_shots_for_tab(shots: &mut Vec<OneShot>, tab_id: &str) {
    shots.retain(|s| s.tab_id != tab_id);
}

#[cfg(test)]
#[path = "one_shot.test.rs"]
mod tests;
