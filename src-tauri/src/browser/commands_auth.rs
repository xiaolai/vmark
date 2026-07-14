//! Authorization commands for the embedded browser driver (WI-2.1 / R4 / R5).
//!
//! The origin/operation/one-shot enforcement surface, split from the lifecycle
//! commands to keep each file under the size limit. `browser_eval` is the
//! authoritative gate; `browser_set_grants` / `browser_add_one_shot` are how the
//! frontend mirrors the user's approvals into the driver, which is the sole
//! authority (a caller that never syncs simply gets default-deny).

use crate::browser::one_shot::{self, OneShot, OneShotTarget};
use crate::browser::operation;
use crate::browser::redact;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::surface::{self, BrowserSurface};
use tauri::{AppHandle, State};

/// Mirror the frontend approval store's standing grants into the driver (WI-2.1).
///
/// The driver's copy is the **authoritative** one: `browser_eval` reads it, so a
/// caller that never syncs simply gets default-deny. Passing an empty vec revokes
/// everything.
#[tauri::command]
pub async fn browser_set_grants(
    state: State<'_, BrowserSurface>,
    grants: Vec<StandingGrant>,
) -> Result<(), String> {
    let mut current = state.grants.lock().map_err(|e| e.to_string())?;
    *current = grants;
    Ok(())
}

/// Mint a single-use authorization from the user's "Allow once" (R5).
///
/// Unlike grants, one-shots are ADDED (never wholesale replaced): the driver
/// consumes them as actions are performed, so pushing a full list would resurrect
/// ones already spent. `browser_eval` consumes a matching one atomically.
#[tauri::command]
pub async fn browser_add_one_shot(
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    origin_pattern: String,
    operation: String,
    target: Option<OneShotTarget>,
) -> Result<(), String> {
    // Reject a pattern the guard could not enforce, rather than storing authority
    // that silently never matches.
    if !origin_guard::is_origin_pattern(&origin_pattern) {
        return Err(format!("not a valid origin pattern: '{origin_pattern}'"));
    }
    // And reject an operation outside the closed vocabulary at the boundary, rather than
    // minting authority the gate can only discover is meaningless later. `operation.rs`
    // says anything outside the set is refused rather than treated as an opaque
    // permission — this is where that becomes true for one-shots. (Audit, Medium.)
    if !operation::is_known_operation(&operation) {
        return Err(format!("not a browser operation: '{operation}'"));
    }
    // The caller states which generation the user APPROVED against, and we refuse the mint
    // unless the tab is still on it.
    //
    // This used to stamp the tab's CURRENT generation instead — which is a different fact.
    // The page can navigate between the prompt being raised and the user clicking "Allow
    // once", and stamping "current" then bound the approval to the page that had just
    // loaded: authority for a page the user never saw. Reading the generation from the
    // caller and *checking* it turns that race into a refusal. (Audit, High.)
    {
        let reg = state.registry.lock().map_err(|e| e.to_string())?;
        let current = reg
            .generation(&tab_id)
            .ok_or_else(|| format!("unknown tab '{tab_id}'"))?;
        if current != generation {
            return Err(format!(
                "stale approval: tab '{tab_id}' navigated since this was authorized \
                 (approved gen {generation}, now {current})"
            ));
        }
    }
    let mut shots = state.one_shots.lock().map_err(|e| e.to_string())?;
    shots.push(OneShot {
        tab_id,
        generation,
        origin_pattern,
        operation,
        target,
    });
    Ok(())
}

/// Evaluate `script` in the driver's isolated content world and return its string
/// result (WI-2.1). The script should `return` a JSON-serializable value.
///
/// **This is the security gate for R4/I3/R7a — the authoritative one.** Callers
/// (the MCP browser tools) also check approval for UX, but that check is advisory:
/// any code path reaching this command is still refused unless all three hold:
///
///   1. `generation` matches the tab's current navigation generation. This closes
///      the TOCTOU where a page navigates between the approval decision and the
///      eval, which would otherwise run an approved script against a *different*
///      origin. A stale command is rejected, never "best-effort" applied.
///   2. The tab has a **committed** top-level URL (R7a). A provisional/in-flight
///      navigation grants nothing — a redirect chain must not briefly authorize an
///      intermediate origin.
///   3. That committed origin grants `operation` (R4/R5). The origin is read from
///      the registry, never from a caller-supplied URL, so a caller cannot assert
///      the origin it wishes it were on.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn browser_eval(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    script: String,
    operation: String,
    generation: u64,
    // The element an `act` targets (absent for a `read`). Passed as structured data
    // — not parsed out of the opaque script — so the authorization decision, and a
    // one-shot's target binding, rest on the descriptor the caller declared.
    role: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    // A target is both halves or neither. `(Some(role), None)` used to fall into the `_`
    // arm and become `None` — silently turning "click the button named Publish" into a
    // target-less authorization, which a target-less one-shot would then satisfy. A
    // half-specified target is a caller bug, and the safe reading of a caller bug in an
    // authorization path is refusal, not the weaker interpretation. (Audit, High.)
    let target = match (role, name) {
        (Some(role), Some(name)) => Some(OneShotTarget { role, name }),
        (None, None) => None,
        (role, name) => {
            return Err(format!(
                "a target needs both role and name (got role={role:?}, name={name:?})"
            ))
        }
    };
    {
        let reg = state.registry.lock().map_err(|e| e.to_string())?;

        if !reg.is_command_fresh(&tab_id, generation) {
            return Err(format!(
                "stale command: tab '{tab_id}' navigated or closed since this operation was authorized"
            ));
        }

        // The origin comes from the registry's committed URL — NOT from the caller.
        let committed = reg.committed_url(&tab_id).ok_or_else(|| {
            format!("tab '{tab_id}' has no committed page; nothing is granted yet")
        })?;

        let grants = state.grants.lock().map_err(|e| e.to_string())?;
        if !origin_guard::is_driver_operation_allowed(committed, &operation, &grants) {
            // No standing authority. A single-use "Allow once" may still authorize
            // this exact action — consumed HERE, atomically, so the check and the
            // spend cannot be separated (and so a one-shot the frontend believed in
            // is actually honored by the authority rather than refused by it). The
            // full descriptor (tab, generation, origin, operation, target) must
            // match, so an approval can't be spent on a different page or element.
            let mut one_shots = state.one_shots.lock().map_err(|e| e.to_string())?;
            if !one_shot::consume_one_shot(
                &mut one_shots,
                &tab_id,
                generation,
                committed,
                &operation,
                target.as_ref(),
            ) {
                // Origin only. The committed URL's query string routinely carries session
                // tokens and document ids, and a refusal log is not a place to persist
                // them. (Audit, Medium.)
                log::warn!(
                    "[browser] REFUSED {operation} on {} (tab {tab_id}): not granted",
                    redact::redact(committed)
                );
                return Err(format!(
                    "operation '{operation}' is not granted for the current origin"
                ));
            }
            log::info!(
                "[browser] {operation} on {} (tab {tab_id}): one-shot consumed",
                redact::redact(committed)
            );
        }
    }

    surface::eval(&app, tab_id, script)
}
