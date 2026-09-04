//! Authorization commands for the embedded browser driver (WI-2.1 / R4 / R5).
//!
//! The origin/operation/one-shot enforcement surface, split from the lifecycle
//! commands to keep each file under the size limit. The authoritative gate
//! (`authorize_driver_op`) lives in `authorize.rs`; these are the
//! `#[tauri::command]` entry points, plus `browser_set_grants` /
//! `browser_add_one_shot`, how the frontend mirrors the user's approvals into
//! the driver — the sole authority (a caller that never syncs gets default-deny).
//!
//! The two commands here that accept caller-supplied script text (`browser_eval`,
//! `browser_add_one_shot`) also apply the authoritative size bound from
//! `script_limit.rs` — a resource guard orthogonal to authorization, and the only
//! copy of that bound below the Tauri command boundary.

use crate::browser::ai_guards::{lock_failure, require_browser_enabled, surface_failure};
use crate::browser::authorize::{authorize_driver_op, command_still_fresh};
use crate::browser::eval_outcome::eval_error;
use crate::browser::mint::{
    attach_ai_tab, mint_one_shot, parse_act_target, script_hash, set_standing_grants,
};
use crate::browser::one_shot::OneShotTarget;
use crate::browser::operation;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::profile_open::{self, ProfileOpen};
use crate::browser::refusals::stale_command;
use crate::browser::script_limit::ensure_script_within_limit;
use crate::browser::surface::{self, BrowserSurface};
use crate::command_error::CommandError;
use tauri::{AppHandle, State};

/// Mirror the invoking window's approval store into the driver (WI-2.1).
///
/// The driver's copy is the **authoritative** one: `browser_eval` reads it, so a
/// caller that never syncs simply gets default-deny. Passing an empty vec revokes
/// everything THIS window granted. The window is the invoking one, from Tauri —
/// each document window syncs its own store, and the driver keeps one slice per
/// window (audit 20260903 A-03). Validation lives in `mint::set_standing_grants`.
/// Cap on driver-side profile-open approvals. Mirrors the frontend's
/// `MAX_PENDING_APPROVALS` (`browserApprovalStore.constants.ts`); the TS test
/// `approvalCapParity.test.ts` reads this line, so the two cannot drift apart.
pub(crate) const MAX_PENDING_PROFILE_OPENS: usize = 64;

#[tauri::command]
pub async fn browser_set_grants(
    webview: tauri::WebviewWindow,
    state: State<'_, BrowserSurface>,
    grants: Vec<StandingGrant>,
) -> Result<(), CommandError> {
    set_standing_grants(&state, webview.label(), grants).map_err(CommandError::invalid_input)
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
    // The exact script a payload-binding one-shot (`style`, `eval`, `session`,
    // `type`, `key`, `scroll`) authorizes. Required for those operations, ignored
    // otherwise. The driver stores only its hash and binds the eval to it — an
    // approved script cannot be swapped out on the retry. (Security review P5,
    // High #1; audit 20260903 A-05.)
    eval_script: Option<String>,
) -> Result<(), CommandError> {
    // Bound the payload before any authority is minted from it. A one-shot bound to
    // a script `browser_eval` would refuse is authority the guard can never spend —
    // "never store authority the guard cannot enforce" (`mint.rs`). `None` is passed
    // through untouched: a missing script is `mint_one_shot`'s call to make.
    if let Some(script) = eval_script.as_deref() {
        ensure_script_within_limit("one-shot eval_script", script)
            .map_err(CommandError::invalid_input)?;
    }
    mint_one_shot(
        &state,
        &tab_id,
        generation,
        &origin_pattern,
        &operation,
        target,
        eval_script,
    )
    .map_err(CommandError::invalid_input)
}

/// Withdraw an unspent one-shot the frontend no longer wants honoured (round 3,
/// #124): a workflow run cancelled while its "Allow once" mint was in flight
/// leaves the driver holding an authorization nobody will spend on purpose. The
/// identity is the mint's own; the count removed is returned (0 is not an error —
/// the one-shot may already have lapsed with a navigation).
#[tauri::command]
pub async fn browser_revoke_one_shot(
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    origin_pattern: String,
    operation: String,
    target: Option<OneShotTarget>,
) -> Result<u32, CommandError> {
    let mut shots = state
        .one_shots
        .lock()
        .map_err(|_| CommandError::internal("one-shot store lock poisoned"))?;
    let removed = crate::browser::one_shot::revoke_one_shot(
        &mut shots,
        &tab_id,
        generation,
        &origin_pattern,
        &operation,
        target.as_ref(),
    );
    Ok(removed as u32)
}

/// Attach AI access to a human-created tab for exactly its current generation.
/// The UI calls this only after the user has accepted the visible prompt.
#[tauri::command]
pub async fn browser_ai_attach(
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    once: Option<bool>,
) -> Result<(), CommandError> {
    attach_ai_tab(&state, &tab_id, generation, once.unwrap_or(false))
        .map_err(CommandError::invalid_input)
}

/// Evaluate `script` in the driver's isolated content world and return its
/// string result (WI-2.1). The script must `return` a JSON STRING; anything else
/// is reported as an `EVAL_FAILED` script error.
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
) -> Result<String, CommandError> {
    // A disabled browser is refused before anything else — including argument
    // validation — preserving the original command's error precedence
    // (BROWSER_DISABLED outranks a malformed target). The shared gate re-checks
    // this authoritatively; this is the cheap up-front guard. (Audit, High.)
    {
        let policy = state.ai_policy.lock().map_err(lock_failure)?;
        require_browser_enabled(&policy)?;
    }
    // THE authoritative script-size bound. The 64 KiB cap also exists in the sidecar
    // and the webview handler, but both sit above this boundary and are therefore
    // advisory — a caller that invokes the command directly was previously handed an
    // unbounded `String`. Bound the payload before interpreting anything else about
    // it; `BROWSER_DISABLED` still outranks it. (Audit 2026-07-28.)
    ensure_script_within_limit("script", &script).map_err(CommandError::invalid_input)?;
    // A target is both halves or neither — see `mint::parse_act_target` (Audit, High).
    let target = parse_act_target(role, name).map_err(CommandError::invalid_input)?;
    // A payload-binding one-shot is bound to the EXACT script; hash it so the gate
    // can match what the user approved against what is about to run. `None` for the
    // target-only operations (click, read), which bind role+name or nothing.
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
    // navigation into the gap. Unlike a click, an eval side effect cannot be undone by
    // a post-check, so freshness is re-verified before the script is handed to WebKit.
    //
    // This check is the CHEAP one — it rejects an already-stale command without paying
    // for a main-thread round trip. It is no longer the last word: `surface::eval` now
    // re-verifies the same generation INSIDE its main-thread closure, in the same turn
    // as the dispatch, which closes the window this check alone used to leave open
    // (Security review P5, High #2 — WI-2.1/2.2).
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(stale_command(&tab_id, "before the script could run"));
    }
    // A timeout, a thrown exception, no value and an oversized result are typed
    // failures (audit 20260903 E-03/E-04), never a `<timeout>`/`<null>` string
    // returned as the script's result.
    surface::eval(&app, tab_id, script, generation).map_err(eval_error)
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
) -> Result<String, CommandError> {
    authorize_driver_op(&state, &tab_id, generation, "read", None, None)?;
    let image = surface::screenshot(&app, tab_id.clone()).map_err(|e| surface_failure(&e))?;
    // The capture pumped the run loop for up to ten seconds; if the page navigated
    // in that window the pixels are from a page the caller was never authorized
    // against. Re-check freshness (without re-consuming consent) and discard a
    // stale capture rather than hand it back (Audit, High).
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(stale_command(&tab_id, "during capture"));
    }
    Ok(image)
}

/// Mint a per-use profile-open grant from the user's "Allow once" (WI-P6.1 H1). The
/// driver is the authority: `browser_ai_create` consumes a matching grant (profile +
/// destination origin) before applying a named profile.
#[tauri::command]
pub async fn browser_add_profile_open(
    state: State<'_, BrowserSurface>,
    profile: String,
    origin_pattern: String,
) -> Result<(), CommandError> {
    profile_open::validate_profile(&profile).map_err(CommandError::invalid_input)?;
    if !origin_guard::is_origin_pattern(&origin_pattern) {
        return Err(CommandError::invalid_input(format!(
            "not a valid origin pattern: '{origin_pattern}'"
        )));
    }
    let mut opens = state.profile_opens.lock().map_err(lock_failure)?;
    // Bound an untrusted client from piling up pending approvals.
    if opens.len() >= MAX_PENDING_PROFILE_OPENS {
        // A bound, not a fault in this request: the client must let earlier
        // approvals resolve first.
        return Err(CommandError::conflict("too many pending profile approvals"));
    }
    opens.push(ProfileOpen {
        profile,
        origin_pattern,
    });
    Ok(())
}

/// Delete a named profile's on-disk WebKit data (WI-P6.5) — user-initiated from the
/// management UI's "Remove profile", so removal actually revokes the login.
#[tauri::command]
pub async fn browser_forget_profile(app: AppHandle, profile: String) -> Result<(), CommandError> {
    profile_open::validate_profile(&profile).map_err(CommandError::invalid_input)?;
    surface::forget_profile(&app, profile).map_err(|e| surface_failure(&e))
}
