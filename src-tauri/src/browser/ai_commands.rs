//! Rust-authoritative commands for AI-owned browser navigation.
//!
//! Kept separate from the human browser lifecycle commands so an AI caller
//! cannot opt into a weaker path with an untrusted boolean argument.

use crate::browser::ai_policy::{validate_ai_navigation_url, AiBrowserPolicy, AiSessionMode};
use crate::browser::one_shot;
use crate::browser::origin_guard::is_operation_granted;
use crate::browser::registry::AutomationMode;
use crate::browser::surface::{self, BrowserSurface};
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

fn ai_policy(state: &BrowserSurface) -> Result<AiBrowserPolicy, String> {
    state
        .ai_policy
        .lock()
        .map(|policy| *policy)
        .map_err(|e| e.to_string())
}

fn authorize_shared_navigation(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    url: &str,
) -> Result<(), String> {
    let grants = state.grants.lock().map_err(|e| e.to_string())?;
    if is_operation_granted(url, "navigate", &grants) {
        return Ok(());
    }
    drop(grants);
    let mut shots = state.one_shots.lock().map_err(|e| e.to_string())?;
    if one_shot::consume_one_shot(&mut shots, tab_id, generation, url, "navigate", None, None) {
        Ok(())
    } else {
        Err("APPROVAL_REQUIRED".into())
    }
}

#[tauri::command]
pub async fn browser_ai_policy(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    enabled: bool,
    session: String,
    allow_loopback: bool,
) -> Result<(), String> {
    let session = match session.as_str() {
        "sandbox" => AiSessionMode::Sandbox,
        "shared" => AiSessionMode::Shared,
        _ => return Err("INVALID_POLICY".into()),
    };
    let mut policy = state.ai_policy.lock().map_err(|e| e.to_string())?;
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
) -> Result<AiNavigationResult, String> {
    let policy = ai_policy(&state)?;
    if !policy.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    let url = validate_ai_navigation_url(&url, policy.allow_loopback)
        .map_err(|_| "SSRF_BLOCKED".to_string())?;
    let mode = policy.automation_mode();
    let window_label = webview.label().to_string();
    let existing_ticket = {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        if let Some(existing_mode) = reg.automation_mode(&tab_id) {
            if existing_mode != mode {
                return Err("TAB_PROVENANCE_MISMATCH".into());
            }
            if reg.policy_epoch(&tab_id) != Some(policy.epoch) {
                return Err("POLICY_STALE".into());
            }
            reg.navigation_ticket(&tab_id)
                .map(|existing| existing.id.clone())
        } else {
            reg.create_with_mode(&tab_id, &window_label, mode)
                .map_err(|e| format!("{e:?}"))?;
            reg.set_policy_epoch(&tab_id, policy.epoch)
                .map_err(|e| format!("{e:?}"))?;
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
            .map_err(|e| e.to_string())?
            .generation(&tab_id)
            .unwrap_or(0);
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    let ticket = {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        let ticket = reg
            .begin_navigation(&tab_id, &url)
            .map_err(|e| format!("{e:?}"))?;
        if mode == AutomationMode::AiShared {
            reg.set_shared_navigation_approval(&tab_id, &url)
                .map_err(|e| format!("{e:?}"))?;
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
            crate::browser::profile_open::validate_profile(&name)?;
            let mut opens = state.profile_opens.lock().map_err(|e| e.to_string())?;
            if !crate::browser::profile_open::consume_profile_open(&mut opens, &name, &url) {
                state.forget_tab(&tab_id)?;
                return Err("PROFILE_NOT_APPROVED".into());
            }
            drop(opens);
            // Pin READ confinement to the approved origin for the tab's whole life
            // (WI-P6.1 H1): the login stays attached across later redirects (SSO works),
            // but the AI can only read this origin, never an off-origin page.
            state
                .registry
                .lock()
                .map_err(|e| e.to_string())?
                .set_profile_origin(&tab_id, &url)
                .map_err(|e| format!("{e:?}"))?;
            Some(name)
        }
        _ => None,
    };
    if let Err(error) =
        surface::create_with_mode(&app, tab_id.clone(), window_label, url, mode, create_profile)
    {
        state.forget_tab(&tab_id)?;
        return Err(error);
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
) -> Result<AiNavigationResult, String> {
    let policy = ai_policy(&state)?;
    if !policy.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    let url = validate_ai_navigation_url(&url, policy.allow_loopback)
        .map_err(|_| "SSRF_BLOCKED".to_string())?;
    let (mode, previous_state, previous_committed_url, previous_ticket, previous_shared_origin) = {
        let reg = state.registry.lock().map_err(|e| e.to_string())?;
        let mode = match reg.automation_mode(&tab_id) {
            Some(mode @ AutomationMode::AiSandbox) => mode,
            Some(mode @ AutomationMode::AiShared) => mode,
            Some(AutomationMode::Human) => return Err("TAB_NOT_AI_OWNED".into()),
            None => return Err("TAB_NOT_FOUND".into()),
        };
        if reg.policy_epoch(&tab_id) != Some(policy.epoch) {
            return Err("POLICY_STALE".into());
        }
        let previous_state = reg
            .state(&tab_id)
            .ok_or_else(|| "TAB_NOT_FOUND".to_string())?;
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
        let reg = state.registry.lock().map_err(|e| e.to_string())?;
        reg.generation(&tab_id).unwrap_or(0)
    };
    if mode == AutomationMode::AiShared {
        authorize_shared_navigation(&state, &tab_id, generation, &url)?;
    }
    let ticket = {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        let ticket = reg
            .begin_navigation(&tab_id, &url)
            .map_err(|e| format!("{e:?}"))?;
        if mode == AutomationMode::AiShared {
            reg.set_shared_navigation_approval(&tab_id, &url)
                .map_err(|e| format!("{e:?}"))?;
        }
        ticket
    };
    if let Err(error) = surface::navigate(&app, tab_id.clone(), url) {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        let _ = reg.rollback_navigation(
            &tab_id,
            &ticket.id,
            previous_state,
            previous_committed_url,
            previous_ticket,
            previous_shared_origin,
        );
        return Err(error);
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
) -> Result<AiBrowserState, String> {
    let reg = state.registry.lock().map_err(|e| e.to_string())?;
    let mode = reg
        .automation_mode(&tab_id)
        .ok_or_else(|| "TAB_NOT_FOUND".to_string())?;
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
