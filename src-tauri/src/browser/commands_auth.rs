//! Authorization commands for the embedded browser driver (WI-2.1 / R4 / R5).
//!
//! The origin/operation/one-shot enforcement surface, split from the lifecycle
//! commands to keep each file under the size limit. The authoritative gate
//! (`authorize_driver_op`) lives in `authorize.rs`; these are the
//! `#[tauri::command]` entry points, plus `browser_set_grants` /
//! `browser_add_one_shot`, how the frontend mirrors the user's approvals into
//! the driver — the sole authority (a caller that never syncs gets default-deny).

use crate::browser::authorize::{authorize_driver_op, command_still_fresh};
use crate::browser::one_shot::{OneShot, OneShotTarget};
use crate::browser::operation;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::registry::AutomationMode;
use crate::browser::surface::{self, BrowserSurface};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

/// Hex SHA-256 of a script — binds a `style`/`eval` one-shot to the EXACT payload
/// the user approved, so an approved-A cannot be spent on a substituted-B on the
/// retry. Computed here (authoritative) both when minting the one-shot and when
/// running the eval. (Security review P5, High #1.)
fn script_hash(script: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(script.as_bytes());
    format!("{:x}", hasher.finalize())
}

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
#[allow(clippy::too_many_arguments)]
pub async fn browser_add_one_shot(
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    origin_pattern: String,
    operation: String,
    target: Option<OneShotTarget>,
    // The exact script a `style`/`eval` one-shot authorizes. Required for those
    // payload-binding operations, ignored otherwise. The driver stores only its
    // hash and binds the eval to it — an approved script cannot be swapped out on
    // the retry. (Security review P5, High #1.)
    eval_script: Option<String>,
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
    // A payload-binding operation (`style`/`eval`) MUST carry its script so the
    // one-shot binds the exact payload — refuse to mint authority that could be
    // spent on a different script than the user approved. (Security review P5.)
    let payload_hash = if operation::operation_binds_payload(&operation) {
        let script = eval_script.ok_or_else(|| {
            format!("operation '{operation}' requires the exact script to bind the approval to")
        })?;
        Some(script_hash(&script))
    } else {
        None
    };
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
        payload_hash,
    });
    Ok(())
}

/// Attach AI access to a human-created tab for exactly its current generation.
/// The UI calls this only after the user has accepted the visible prompt.
#[tauri::command]
pub async fn browser_ai_attach(
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    once: Option<bool>,
) -> Result<(), String> {
    let reg = state.registry.lock().map_err(|e| e.to_string())?;
    if reg.automation_mode(&tab_id) != Some(AutomationMode::Human) {
        return Err("TAB_NOT_HUMAN".into());
    }
    if reg.generation(&tab_id) != Some(generation) {
        return Err("STALE_NAVIGATION".into());
    }
    drop(reg);
    state.attach_tab(tab_id, generation, once.unwrap_or(false))
}

/// Evaluate `script` in the driver's isolated content world and return its
/// string result (WI-2.1). The script should `return` a JSON-serializable value.
/// Authorization is delegated to `authorize_driver_op` (the shared gate); this
/// command adds only the `act`-target validation and the eval side effect.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn browser_eval(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    script: String,
    operation: String,
    generation: u64,
    role: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    // A disabled browser is refused before anything else — including argument
    // validation — preserving the original command's error precedence
    // (BROWSER_DISABLED outranks a malformed target). The shared gate re-checks
    // this authoritatively; this is the cheap up-front guard. (Audit, High.)
    if !state.ai_policy.lock().map_err(|e| e.to_string())?.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    // A target is both halves or neither. `(Some(role), None)` must NOT fall
    // through to a target-less authorization (which a target-less one-shot would
    // then satisfy) — a half-specified target is a caller bug, and the safe
    // reading of a caller bug in an authorization path is refusal. (Audit, High.)
    let target = match (role, name) {
        (Some(role), Some(name)) => Some(OneShotTarget { role, name }),
        (None, None) => None,
        (role, name) => {
            return Err(format!(
                "a target needs both role and name (got role={role:?}, name={name:?})"
            ))
        }
    };
    // A `style`/`eval` one-shot is bound to the EXACT script; hash it so the gate can
    // match what the user approved against what is about to run. `None` for the
    // target-only operations (click/type/…), which bind role+name instead.
    let payload_hash = operation::operation_binds_payload(&operation).then(|| script_hash(&script));
    authorize_driver_op(
        &state,
        &tab_id,
        generation,
        &operation,
        target.as_ref(),
        payload_hash.as_deref(),
    )?;
    // Authorization and dispatch are separate steps, and a hostile page can time a
    // navigation into the gap. Unlike a click, an eval side effect cannot be undone
    // by a post-check, so re-verify freshness immediately before handing the script
    // to the main-thread WebKit dispatch — a page that navigated (bumping the
    // generation / clearing the committed origin) between authorization and here is
    // refused rather than scripted against the wrong document. This narrows the race
    // to the residual window between this check and the main-thread closure actually
    // running; fully closing it requires the committed-generation re-check to move
    // INSIDE surface::eval's main-thread closure (which needs the registry threaded
    // in — tracked as a follow-up). (Security review P5, High #2.)
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(format!(
            "stale command: tab '{tab_id}' navigated or closed before the script could run"
        ));
    }
    surface::eval(&app, tab_id, script)
}

/// Capture the tab's current rendering as a base64 JPEG (WI-P1.1).
///
/// Read-class: it authorizes exactly like `read` — an AI-owned tab may capture
/// its own committed page; a human tab requires an attachment (consumed on
/// capture). It carries no `role`/`name` target. The capture reads no page DOM
/// or JS (native `takeSnapshot`), but it can still expose on-screen secrets, so
/// it passes the identical freshness + committed-origin + policy-epoch gate as
/// `browser_eval` — via the shared `authorize_driver_op` — before any pixels are
/// read.
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
) -> Result<String, String> {
    authorize_driver_op(&state, &tab_id, generation, "read", None, None)?;
    let image = surface::screenshot(&app, tab_id.clone())?;
    // The capture pumped the run loop for up to ten seconds; if the page navigated
    // in that window the pixels are from a page the caller was never authorized
    // against. Re-check freshness (without re-consuming consent) and discard a
    // stale capture rather than hand it back (Audit, High).
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(format!(
            "stale command: tab '{tab_id}' navigated or closed during capture"
        ));
    }
    Ok(image)
}
