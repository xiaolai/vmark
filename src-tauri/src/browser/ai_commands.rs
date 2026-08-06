//! Rust-authoritative commands for AI-owned browser navigation.
//!
//! Kept separate from the human browser lifecycle commands so an AI caller
//! cannot opt into a weaker path with an untrusted boolean argument.
//!
//! WI-14: every refusal here is a [`CommandError`] with a `code`, not a bare
//! `"APPROVAL_REQUIRED"`-style string. The MCP bridge used to recover the class
//! with `String(error).includes("APPROVAL_REQUIRED")` at four call sites — a
//! substring match that any URL carrying that token would have triggered, and
//! that rewording the refusal would have silently disabled. The security-load-
//! bearing distinction is `approval-required` (raise a prompt, then retry)
//! versus `permission-denied` (no approval can unblock it).
//!
//! The refusal guards live in `ai_guards.rs` so each policy decision is
//! unit-testable without a mock Tauri app.

use super::ai_guards::{
    ai_policy, authorize_shared_navigation, invalid_profile_name, lock_failure, parse_session_mode,
    rejected_destination, require_ai_owned, require_browser_enabled, require_current_epoch,
    surface_failure, tab_not_found, with_mcp_code,
};
use crate::browser::ai_policy::{validate_ai_navigation_url, AiSessionMode};
use crate::browser::registry::AutomationMode;
use crate::browser::surface::{self, BrowserSurface};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, serde::Serialize)]
pub struct AiNavigationResult {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    #[serde(rename = "navigationId")]
    pub navigation_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AiBrowserState {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    #[serde(rename = "automationMode")]
    pub automation_mode: AutomationMode,
    pub generation: u64,
    pub lifecycle: String,
    #[serde(rename = "navigationId", skip_serializing_if = "Option::is_none")]
    pub navigation_id: Option<String>,
}

#[tauri::command]
pub async fn browser_ai_policy(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    enabled: bool,
    session: String,
    allow_loopback: bool,
) -> Result<(), CommandError> {
    let session = parse_session_mode(&session)?;
    let mut policy = state.ai_policy.lock().map_err(lock_failure)?;
    let changed = policy.enabled != enabled
        || policy.session != session
        || policy.allow_loopback != allow_loopback;
    if changed {
        policy.epoch = policy.epoch.saturating_add(1);
    }
    policy.enabled = enabled;
    policy.session = session;
    policy.allow_loopback = allow_loopback;
    drop(policy);
    if changed && (!enabled || session == AiSessionMode::Sandbox) {
        let _ = surface::clear_ai_sandbox_store(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_ai_create(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
    // Optional named profile (WI-P6.1): an AiSandbox tab opened against a `profile`
    // uses an isolated persistent store so a login persists for reuse. Opening a
    // profile is per-use user-approved — a matching profile-open grant is consumed
    // authoritatively below, BEFORE the profile is applied (H1).
    profile: Option<String>,
) -> Result<AiNavigationResult, CommandError> {
    let policy = ai_policy(&state)?;
    require_browser_enabled(&policy)?;
    let url = validate_ai_navigation_url(&url, policy.allow_loopback)
        .map_err(|error| rejected_destination(error, &url))?;
    let mode = policy.automation_mode();
    let window_label = webview.label().to_string();
    let existing_ticket = {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        if let Some(existing_mode) = reg.automation_mode(&tab_id) {
            if existing_mode != mode {
                return Err(with_mcp_code(
                    localized_error!(ErrorCode::Conflict, "errors.browser.tabProvenanceMismatch"),
                    "TAB_PROVENANCE_MISMATCH",
                ));
            }
            require_current_epoch(reg.policy_epoch(&tab_id), policy.epoch)?;
            reg.navigation_ticket(&tab_id)
                .map(|existing| existing.id.clone())
        } else {
            reg.create_with_mode(&tab_id, &window_label, mode)?;
            reg.set_policy_epoch(&tab_id, policy.epoch)?;
            None
        }
    };
    if let Some(navigation_id) = existing_ticket {
        return Ok(AiNavigationResult {
            tab_id,
            navigation_id,
        });
    }
    if mode == AutomationMode::AiShared {
        let generation = state
            .registry
            .lock()
            .map_err(lock_failure)?
            .generation(&tab_id)
            .unwrap_or(0);
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    let ticket = {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        let ticket = reg.begin_navigation(&tab_id, &url)?;
        if mode == AutomationMode::AiShared {
            reg.set_shared_navigation_approval(&tab_id, &url)?;
        }
        ticket
    };
    // A named profile only applies to an AiSandbox tab, and opening it requires a
    // fresh per-use approval (H1): consume a profile-open grant bound to (profile,
    // this destination origin) BEFORE the profile is applied. No grant → refuse and
    // NEVER apply the profile (so a guessed profile can't silently open authenticated
    // content). The frontend raises the approval; the driver is the authority.
    let create_profile = match (mode, profile) {
        (AutomationMode::AiSandbox, Some(name)) => {
            crate::browser::profile_open::validate_profile(&name)
                .map_err(|reason| invalid_profile_name(&name, &reason))?;
            let mut opens = state.profile_opens.lock().map_err(lock_failure)?;
            if !crate::browser::profile_open::consume_profile_open(&mut opens, &name, &url) {
                state.forget_tab(&tab_id).map_err(lock_failure)?;
                return Err(with_mcp_code(
                    localized_error!(
                        ErrorCode::PermissionDenied,
                        "errors.browser.profileNotApproved"
                    ),
                    "PROFILE_NOT_APPROVED",
                ));
            }
            drop(opens);
            // Pin READ confinement to the approved origin for the tab's whole life
            // (WI-P6.1 H1): the login stays attached across later redirects (SSO works),
            // but the AI can only read this origin, never an off-origin page.
            state
                .registry
                .lock()
                .map_err(lock_failure)?
                .set_profile_origin(&tab_id, &url)?;
            Some(name)
        }
        _ => None,
    };
    if let Err(error) = surface::create_with_mode(
        &app,
        tab_id.clone(),
        window_label,
        url,
        mode,
        create_profile,
    ) {
        state.forget_tab(&tab_id).map_err(lock_failure)?;
        return Err(surface_failure(&error));
    }
    Ok(AiNavigationResult {
        tab_id,
        navigation_id: ticket.id,
    })
}

#[tauri::command]
pub async fn browser_ai_navigate(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
) -> Result<AiNavigationResult, CommandError> {
    let policy = ai_policy(&state)?;
    require_browser_enabled(&policy)?;
    let url = validate_ai_navigation_url(&url, policy.allow_loopback)
        .map_err(|error| rejected_destination(error, &url))?;
    let (mode, previous_state, previous_committed_url, previous_ticket, previous_shared_origin) = {
        let reg = state.registry.lock().map_err(lock_failure)?;
        let mode = require_ai_owned(reg.automation_mode(&tab_id))?;
        require_current_epoch(reg.policy_epoch(&tab_id), policy.epoch)?;
        let previous_state = reg.state(&tab_id).ok_or_else(tab_not_found)?;
        let previous_committed_url = reg.committed_url(&tab_id).map(str::to_owned);
        let previous_ticket = reg.navigation_ticket(&tab_id).cloned();
        let previous_shared_origin = reg.shared_navigation_origin(&tab_id);
        (
            mode,
            previous_state,
            previous_committed_url,
            previous_ticket,
            previous_shared_origin,
        )
    };
    let generation = {
        let reg = state.registry.lock().map_err(lock_failure)?;
        reg.generation(&tab_id).unwrap_or(0)
    };
    if mode == AutomationMode::AiShared {
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    let ticket = {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        let ticket = reg.begin_navigation(&tab_id, &url)?;
        if mode == AutomationMode::AiShared {
            reg.set_shared_navigation_approval(&tab_id, &url)?;
        }
        ticket
    };
    if let Err(error) = surface::navigate(&app, tab_id.clone(), url) {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        let _ = reg.rollback_navigation(
            &tab_id,
            &ticket.id,
            previous_state,
            previous_committed_url,
            previous_ticket,
            previous_shared_origin,
        );
        return Err(surface_failure(&error));
    }
    Ok(AiNavigationResult {
        tab_id,
        navigation_id: ticket.id,
    })
}

#[tauri::command]
pub async fn browser_ai_state(
    state: State<'_, BrowserSurface>,
    tab_id: String,
) -> Result<AiBrowserState, CommandError> {
    let reg = state.registry.lock().map_err(lock_failure)?;
    let mode = reg.automation_mode(&tab_id).ok_or_else(tab_not_found)?;
    let generation = reg.generation(&tab_id).unwrap_or(0);
    let lifecycle = reg
        .state(&tab_id)
        .map(|state| format!("{state:?}"))
        .unwrap_or_else(|| "Destroyed".into());
    let navigation_id = reg
        .navigation_ticket(&tab_id)
        .map(|ticket| ticket.id.clone());
    Ok(AiBrowserState {
        tab_id,
        automation_mode: mode,
        generation,
        lifecycle,
        navigation_id,
    })
}

#[cfg(test)]
#[path = "ai_commands.test.rs"]
mod tests;
