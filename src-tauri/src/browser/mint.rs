//! Authorization **inputs**: what authority may be created (WI-1.1..1.6).
//!
//! `authorize.rs` answers "may this operation run?". This module answers the prior
//! question — "may this authority exist at all?" — and is split out for the same
//! reason `authorize.rs` was: it lived inline in `commands_auth.rs`, whose
//! `#[tauri::command]` signatures take `State<'_, BrowserSurface>` and so cannot be
//! unit-tested without a Tauri harness (which is cfg-gated off Windows entirely,
//! see `Cargo.toml`). Taking `&BrowserSurface` makes every rule below directly
//! testable, and keeps the security-relevant decisions out of thin command wrappers
//! where a second copy could drift (rule 60 §10).
//!
//! The governing principle, shared by every function here: **never store authority
//! the guard cannot enforce.** A malformed origin pattern or an out-of-vocabulary
//! operation is inert — it silently never matches — so the user believes they
//! approved something that in fact does nothing. Refuse at the boundary instead.
//!
//! @coordinates-with browser/commands_auth.rs — the command entry points
//! @coordinates-with browser/authorize.rs — the decision this authority feeds
//! @coordinates-with browser/one_shot.rs — consumption of what is minted here

use crate::browser::one_shot::{OneShot, OneShotTarget};
use crate::browser::operation;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::registry::AutomationMode;
use crate::browser::surface::BrowserSurface;
use sha2::{Digest, Sha256};

/// Cap on live single-use authorizations. An untrusted MCP client drives the
/// approval prompts, so the vector must not be growable without bound.
pub(crate) const MAX_ONE_SHOTS: usize = 256;

/// Cap on standing grants mirrored from the frontend store.
pub(crate) const MAX_GRANTS: usize = 512;

/// Hex SHA-256 of a script — binds a `style`/`eval`/`session` one-shot to the EXACT
/// payload the user approved, so an approved-A cannot be spent on a substituted-B on
/// the retry. Computed authoritatively both when minting and when running.
/// (Security review P5, High #1.)
pub(crate) fn script_hash(script: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(script.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Parse an `act` target from the command's optional role/name pair.
///
/// A target is **both halves or neither**. `(Some(role), None)` must NOT fall through
/// to a target-less authorization, which a target-less one-shot would then satisfy —
/// acting on an element the user never approved. A half-specified target is a caller
/// bug, and the safe reading of a caller bug in an authorization path is refusal.
/// (Audit, High.)
pub(crate) fn parse_act_target(
    role: Option<String>,
    name: Option<String>,
) -> Result<Option<OneShotTarget>, String> {
    match (role, name) {
        (Some(role), Some(name)) => Ok(Some(OneShotTarget { role, name })),
        (None, None) => Ok(None),
        (role, name) => Err(format!(
            "a target needs both role and name (got role={role:?}, name={name:?})"
        )),
    }
}

/// Mint a single-use authorization from the user's "Allow once" (R5).
///
/// Refuses, in order: an unenforceable origin pattern, an operation outside the closed
/// vocabulary, a payload-binding operation with no script to bind, an unknown tab, a
/// **stale approved generation**, and a full vector.
///
/// The generation is the one the caller states the user APPROVED against — not the
/// tab's current one. Those are different facts: the page can navigate between the
/// prompt being raised and the click on "Allow once", and stamping "current" would bind
/// the approval to a page the user never saw. Reading it from the caller and *checking*
/// it turns that race into a refusal. (Audit, High.)
pub(crate) fn mint_one_shot(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    origin_pattern: &str,
    operation_name: &str,
    target: Option<OneShotTarget>,
    eval_script: Option<String>,
) -> Result<(), String> {
    if !origin_guard::is_origin_pattern(origin_pattern) {
        return Err(format!("not a valid origin pattern: '{origin_pattern}'"));
    }
    if !operation::is_known_operation(operation_name) {
        return Err(format!("not a browser operation: '{operation_name}'"));
    }
    // [Audit Medium] Refuse what consumption can never honour. `upload` is
    // NEVER_AUTOMATED, so a one-shot for it is inert authority — it occupies a slot
    // against MAX_ONE_SHOTS and shows the user an approval that could never fire.
    // The module's stated principle is "never store authority the guard cannot
    // enforce"; accepting `upload` here violated it.
    if operation::NEVER_AUTOMATED.contains(&operation_name) {
        return Err(format!(
            "operation '{operation_name}' is never automated and cannot be authorized"
        ));
    }
    let payload_hash = if operation::operation_binds_payload(operation_name) {
        let script = eval_script.ok_or_else(|| {
            format!(
                "operation '{operation_name}' requires the exact script to bind the approval to"
            )
        })?;
        Some(script_hash(&script))
    } else {
        None
    };
    // [Audit Medium] The generation check and the insertion must be ATOMIC. With the
    // registry guard released in between, a navigation could clear this tab's
    // one-shots after the check and before the push — leaving a permanently stale
    // entry that can never be consumed but still counts against the cap. Hold the
    // registry guard across both, in the established registry → one_shots order.
    let reg = state.registry.lock().map_err(|e| e.to_string())?;
    let current = reg
        .generation(tab_id)
        .ok_or_else(|| format!("unknown tab '{tab_id}'"))?;
    if current != generation {
        return Err(format!(
            "stale approval: tab '{tab_id}' navigated since this was authorized \
             (approved gen {generation}, now {current})"
        ));
    }
    let mut shots = state.one_shots.lock().map_err(|e| e.to_string())?;
    if shots.len() >= MAX_ONE_SHOTS {
        return Err("too many pending single-use authorizations".into());
    }
    shots.push(OneShot {
        tab_id: tab_id.to_string(),
        generation,
        origin_pattern: origin_pattern.to_string(),
        operation: operation_name.to_string(),
        target,
        payload_hash,
    });
    drop(shots);
    drop(reg);
    Ok(())
}

/// Attach AI access to a **human** tab for exactly its current generation. The UI calls
/// this only after the user accepted the visible prompt; the exact tab+generation
/// binding is what stops an attachment following a navigation or a reused tab id.
pub(crate) fn attach_ai_tab(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    once: bool,
) -> Result<(), String> {
    {
        let reg = state.registry.lock().map_err(|e| e.to_string())?;
        if reg.automation_mode(tab_id) != Some(AutomationMode::Human) {
            return Err("TAB_NOT_HUMAN".into());
        }
        if reg.generation(tab_id) != Some(generation) {
            return Err("STALE_NAVIGATION".into());
        }
    }
    state.attach_tab(tab_id.to_string(), generation, once)
}

/// Mirror the frontend approval store's standing grants into the driver (WI-2.1).
///
/// The driver's copy is authoritative — `browser_eval` reads it — so a caller that
/// never syncs simply gets default-deny, and an empty vec revokes everything.
///
/// **Validated as strictly as a one-shot is (WI-1.6).** Previously this accepted the
/// vector verbatim, so a malformed pattern was stored as authority the guard could
/// never match: invisible to the user, who sees a grant that does nothing.
///
/// **On a rejected batch the store is CLEARED, not left alone.** [Audit Medium] An
/// earlier comment here claimed a revocation "always applies"; that was wrong. This is
/// a REPLACEMENT sync, so a batch that revokes origin A while carrying one malformed
/// unrelated entry would, under retain-on-error, leave A authorized indefinitely — the
/// user revokes access and it silently does not take. Clearing fails CLOSED: the worst
/// case is the user re-approves, versus authority outliving its revocation.
pub(crate) fn set_standing_grants(
    state: &BrowserSurface,
    grants: Vec<StandingGrant>,
) -> Result<(), String> {
    let validated = (|| -> Result<(), String> {
        if grants.len() > MAX_GRANTS {
            return Err(format!("too many grants (max {MAX_GRANTS})"));
        }
        for g in &grants {
            if !origin_guard::is_origin_pattern(&g.origin_pattern) {
                return Err(format!(
                    "not a valid origin pattern: '{}'",
                    g.origin_pattern
                ));
            }
            for op in &g.operations {
                if !operation::is_known_operation(op) {
                    return Err(format!("not a browser operation: '{op}'"));
                }
                // Refuse authority a standing grant can never confer: `upload` is
                // NEVER_AUTOMATED and `eval`/`session` are NEVER_GRANTABLE, so the
                // guard rejects them regardless. Storing them is inert state that
                // misrepresents what the user has allowed.
                if operation::NEVER_AUTOMATED.contains(&op.as_str())
                    || operation::NEVER_GRANTABLE.contains(&op.as_str())
                {
                    return Err(format!(
                        "operation '{op}' can never be granted standing authority"
                    ));
                }
            }
        }
        Ok(())
    })();

    let mut current = state.grants.lock().map_err(|e| e.to_string())?;
    match validated {
        Ok(()) => {
            *current = grants;
            Ok(())
        }
        Err(reason) => {
            // Fail CLOSED — see the doc comment. Never retain prior authority past a
            // failed replacement.
            current.clear();
            Err(reason)
        }
    }
}

#[cfg(test)]
#[path = "mint.test.rs"]
mod tests;
