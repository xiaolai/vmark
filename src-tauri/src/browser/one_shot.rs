//! Single-use browser authorizations — the user's "Allow once" (WI-2.1 / R5).
//!
//! These live in the DRIVER, not in the frontend store, because the driver is the
//! authority. A one-shot held only by the frontend would be checked there and then
//! refused here (the gate demands a standing grant it never receives) — so it would
//! authorize nothing at all. It is minted via `browser_add_one_shot` and consumed
//! by `browser_eval`.
//!
//! Consumption is deliberately not separable from the check: a one-shot authorizes
//! exactly ONE action, so `consume_one_shot` removes it as it answers.
//!
//! @coordinates-with browser/origin_guard.rs — the shared matching rules
//! @coordinates-with services/browser/grantSync.ts — mints these from the store

use crate::browser::origin_guard::{canonicalize_origin, origin_matches_pattern, NEVER_AUTOMATED};

/// A single-use authorization bound to an origin pattern + operation.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OneShot {
    #[serde(rename = "originPattern")]
    pub origin_pattern: String,
    pub operation: String,
}

/// Spend a one-shot authorizing `operation` on `target_url`, if one matches.
///
/// Origin matching goes through the same guard as standing grants (never looser),
/// and a never-automatable operation is refused even if a one-shot for it somehow
/// exists — defense in depth against a malformed mint.
pub fn consume_one_shot(shots: &mut Vec<OneShot>, target_url: &str, operation: &str) -> bool {
    if NEVER_AUTOMATED.contains(&operation) {
        return false;
    }
    let Some(target) = canonicalize_origin(target_url) else {
        return false;
    };
    let Some(index) = shots.iter().position(|s| {
        s.operation == operation && origin_matches_pattern(&target, &s.origin_pattern)
    }) else {
        return false;
    };
    shots.remove(index);
    true
}

#[cfg(test)]
#[path = "one_shot.test.rs"]
mod tests;
