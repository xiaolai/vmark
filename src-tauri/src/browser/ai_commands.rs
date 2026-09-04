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
//! The commands are COMPOSITION only. The refusal guards live in `ai_guards.rs`
//! and the state transactions — reservation, ticketing, profile authorization,
//! the native call with its compensation — in `ai_transactions.rs` (audit
//! 20260903 round 3, #2), so each policy decision and each guard-holding step is
//! unit-testable without a mock Tauri app, and the order they run in is the one
//! thing left to read here.

use super::ai_guards::{
    ai_policy, authorize_shared_navigation, invalid_profile_name, lock_failure, parse_session_mode,
    rejected_destination, require_ai_owned, require_browser_enabled, require_current_epoch,
    surface_failure, tab_not_found,
};
use crate::browser::ai_policy::{validate_ai_navigation_url, AiSessionMode};
use crate::browser::registry::{AiReservation, AiTabRequest, AutomationMode, TabStatus};
use crate::browser::surface::{self, BrowserSurface};
use crate::command_error::CommandError;
use tauri::{AppHandle, State};

#[path = "ai_transactions.rs"]
mod transactions;
use transactions::{
    authorize_profile, begin_ai_navigation, create_native, navigate_native, profile_for_mode,
    reserve_ai_tab,
};

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

impl AiBrowserState {
    /// One registry read → the wire shape (audit round 3, #5). Every field comes
    /// from the same entry, so there is nothing to default: the old per-field
    /// reads fell back to generation 0 and "Destroyed" for a tab whose mode had
    /// just been read under the same guard — fallbacks that could only ever hide
    /// an invariant violation. `lifecycle` stays the Debug rendering the frontend
    /// matches on.
    fn from_status(tab_id: String, status: TabStatus) -> Self {
        Self {
            tab_id,
            automation_mode: status.automation_mode,
            generation: status.generation,
            lifecycle: format!("{:?}", status.state),
            navigation_id: status.navigation_id,
        }
    }
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
    let changed = {
        let policy = state.ai_policy.lock().map_err(lock_failure)?;
        policy.enabled != enabled
            || policy.session != session
            || policy.allow_loopback != allow_loopback
    };
    // The reset runs BEFORE the new posture is published (audit round 2, #1): a
    // sandbox tab created between a published posture and its reset would reuse
    // storage from the previous one. While the reset runs the OLD policy is still
    // the one in force, so a concurrent creation is consistent with the store it
    // gets; and a failed reset is a failed activation — nothing changes and the
    // caller learns about it instead of hearing "done".
    if changed && (!enabled || session == AiSessionMode::Sandbox) {
        if let Err(error) = surface::clear_ai_sandbox_store(&app) {
            return Err(surface_failure(&error));
        }
    }
    let mut policy = state.ai_policy.lock().map_err(lock_failure)?;
    if changed {
        // Bumped whether or not another setter interleaved: an epoch only
        // invalidates tabs, never widens anything.
        policy.epoch = policy.epoch.saturating_add(1);
    }
    policy.enabled = enabled;
    policy.session = session;
    policy.allow_loopback = allow_loopback;
    Ok(())
}

/// Create an AI-owned tab and start its first navigation. Steps, in order:
/// policy and destination validation (pure); the reservation (#3 — an existing
/// id is honoured only as the SAME request); shared-posture authorization; the
/// ticket; the profile grant (WI-P6.1 H1, consumed BEFORE the profile is
/// applied); the native creation, which forgets the tab if it fails.
#[tauri::command]
pub async fn browser_ai_create(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
    // Optional named profile (WI-P6.1): an AiSandbox tab opened against a `profile`
    // uses an isolated persistent store so a login persists for reuse. Opening a
    // profile is per-use user-approved — `authorize_profile` consumes the grant.
    profile: Option<String>,
) -> Result<AiNavigationResult, CommandError> {
    let policy = ai_policy(&state)?;
    require_browser_enabled(&policy)?;
    let url = validate_ai_navigation_url(&url, policy.allow_loopback)
        .map_err(|error| rejected_destination(error, &url))?;
    let mode = policy.automation_mode();
    // A profile applies to an AiSandbox tab only, and asking for one under the
    // shared posture is now a REFUSAL rather than a silent downgrade — see
    // `profile_for_mode`. Its NAME is validated before anything is reserved, so an
    // illegal one leaves no entry behind either; it used to fail after the ticket
    // was minted, leaving a reservation nothing would ever create.
    let profile = profile_for_mode(mode, profile)?;
    if let Some(name) = profile.as_deref() {
        crate::browser::profile_open::validate_profile(name)
            .map_err(|reason| invalid_profile_name(name, &reason))?;
    }
    // The window is the INVOKING one, taken from Tauri — never a caller's claim.
    let window_label = webview.label().to_string();
    let request = AiTabRequest {
        window_label: &window_label,
        mode,
        url: &url,
        profile: profile.as_deref(),
        policy_epoch: policy.epoch,
    };
    let generation = match reserve_ai_tab(&state, &tab_id, &request)? {
        AiReservation::Existing { navigation_id } => {
            return Ok(AiNavigationResult {
                tab_id,
                navigation_id,
            })
        }
        // A fresh entry is registered at generation 0 (pinned in registry_ai.test.rs).
        AiReservation::Reserved => 0,
        AiReservation::Resumed { generation } => generation,
    };
    if mode == AutomationMode::AiShared {
        // Refused pending approval → the reservation stays, and the SAME request
        // resumes it once the user has decided (see `reserve_ai_tab`).
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    let (ticket, _replaced) = begin_ai_navigation(&state, &tab_id, &url, mode)?;
    let create_profile = authorize_profile(&state, &tab_id, profile, &url)?;
    // `allow_loopback` reaches the native layer so the AI webview's content rule
    // list (audit 20260903 P-01) is compiled for the same posture the URL was
    // validated against.
    create_native(&state, &tab_id, || {
        surface::create_with_mode(
            &app,
            tab_id.clone(),
            window_label,
            url,
            mode,
            create_profile,
            policy.allow_loopback,
        )
    })?;
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
    let (mode, generation) = {
        let reg = state.registry.lock().map_err(lock_failure)?;
        let Some(status) = reg.tab_status(&tab_id) else {
            return Err(tab_not_found());
        };
        let mode = require_ai_owned(Some(status.automation_mode))?;
        require_current_epoch(Some(status.policy_epoch), policy.epoch)?;
        (mode, status.generation)
    };
    if mode == AutomationMode::AiShared {
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    // Snapshot and begin under ONE guard (#4): a native failure below restores
    // exactly the state this navigation replaced, and only while its ticket is
    // still the active one.
    let (ticket, replaced) = begin_ai_navigation(&state, &tab_id, &url, mode)?;
    navigate_native(&state, &tab_id, &ticket, replaced, || {
        surface::navigate(&app, tab_id.clone(), url)
    })?;
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
    let status = state
        .registry
        .lock()
        .map_err(lock_failure)?
        .tab_status(&tab_id)
        .ok_or_else(tab_not_found)?;
    Ok(AiBrowserState::from_status(tab_id, status))
}

#[cfg(test)]
#[path = "ai_commands.test.rs"]
mod tests;
