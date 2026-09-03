//! Refusal guards for the AI browser commands (WI-14).
//!
//! Split out of `ai_commands.rs` so each policy decision is unit-testable
//! without a mock Tauri app — the commands become composition, and every
//! refusal has a test naming its `code`. Before WI-14 these were bare
//! `"APPROVAL_REQUIRED"`-style strings that the MCP bridge recovered with
//! `String(error).includes(...)`; the security-load-bearing distinction is
//! `approval-required` (raise a prompt, then retry) versus `permission-denied`
//! (no approval can unblock it).
//!
//! @coordinates-with browser/ai_commands.rs — the only caller
//! @coordinates-with browser/surface_failure.rs — native-failure classification
//! @module browser::ai_guards

use crate::browser::ai_policy::{AiBrowserPolicy, AiSessionMode, AiUrlError};
use crate::browser::one_shot;
use crate::browser::registry::{AutomationMode, MAX_AI_TABS};
use crate::browser::surface::BrowserSurface;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

#[path = "surface_failure.rs"]
mod surface_failure_impl;
pub(super) use surface_failure_impl::surface_failure;

/// The token the MCP client already knows this refusal by.
///
/// `code` is VMark's internal error class; `detail.mcpCode` is the MCP tool
/// protocol's own vocabulary, which predates WI-14 and is finer-grained in
/// places (`SSRF_BLOCKED` and `PROFILE_NOT_APPROVED` are both
/// `permission-denied`). Keeping them as separate channels means the frontend
/// branches on the class while the AI client keeps the exact token it has been
/// shipped — neither audience has to parse the other's vocabulary.
pub(super) fn with_mcp_code(error: CommandError, mcp_code: &str) -> CommandError {
    let mut detail = error
        .detail()
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
    if let Some(object) = detail.as_object_mut() {
        object.insert("mcpCode".into(), json!(mcp_code));
    }
    error.with_detail(detail)
}

/// A poisoned mutex is a bug in this process, not something the caller did.
///
/// RESERVED for exactly that (audit 20260803 §7). It used to double as the
/// catch-all for native creation and navigation failures, so a closed window or
/// a URL WebKit rejected was reported as an internal state-read failure — see
/// [`surface_failure`], which is what those callers use now.
pub(super) fn lock_failure(error: impl std::fmt::Display) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.browser.stateUnavailable",
        detail = error.to_string()
    )
}

/// The AI handed us something that is not a destination at all — a typo, an
/// empty string, a truncated paste (audit 20260803 §6).
///
/// Split out of [`blocked_destination`], which used to swallow every
/// `AiUrlError`: a malformed URL reached the caller as `permission-denied` +
/// `SSRF_BLOCKED`, i.e. a SECURITY refusal for a fixable mistake. The
/// `detail.mcpCode` channel stays faithful to the split — real refusals keep
/// the token the MCP client already ships with, and this one gets its own.
pub(super) fn invalid_destination(url: &str) -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::InvalidInput, "errors.browser.invalidUrl")
            .with_detail(json!({ "kind": "ai-url-invalid", "url": url })),
        "INVALID_URL",
    )
}

/// Map a rejected AI destination onto the refusal it actually is.
pub(super) fn rejected_destination(error: AiUrlError, url: &str) -> CommandError {
    match error {
        AiUrlError::Blocked => blocked_destination(),
        AiUrlError::Invalid => invalid_destination(url),
    }
}

/// The AI named a profile that is not a legal profile name. Caller-side
/// validation, so `invalid-input` — but it must still be a TRANSLATED error
/// carrying an `i18nKey` (audit 20260803 §10): it reaches the user through the
/// same surface as every other refusal, and a raw English validator sentence
/// was the one string in this module that `lint:i18n` could not see.
pub(super) fn invalid_profile_name(profile: &str, reason: &str) -> CommandError {
    localized_error!(ErrorCode::InvalidInput, "errors.browser.invalidProfileName").with_detail(
        json!({ "kind": "invalid-profile-name", "profile": profile, "detail": reason }),
    )
}

/// The embedded browser is off in Settings. WI-19's dark-feature gates return
/// this same code, which is why `FeatureDisabled` shipped with WI-14.
pub(super) fn require_browser_enabled(policy: &AiBrowserPolicy) -> Result<(), CommandError> {
    if policy.enabled {
        Ok(())
    } else {
        Err(with_mcp_code(
            localized_error!(ErrorCode::FeatureDisabled, "errors.browser.disabled"),
            "BROWSER_DISABLED",
        ))
    }
}

/// Parse the wire form of the AI session mode. The rejected value travels in
/// `detail.mode` so the caller can report it without parsing the sentence.
pub(super) fn parse_session_mode(session: &str) -> Result<AiSessionMode, CommandError> {
    match session {
        "sandbox" => Ok(AiSessionMode::Sandbox),
        "shared" => Ok(AiSessionMode::Shared),
        other => Err(with_mcp_code(
            localized_error!(
                ErrorCode::InvalidInput,
                "errors.browser.invalidSessionMode",
                mode = other
            )
            .with_detail(json!({ "mode": other })),
            "INVALID_POLICY",
        )),
    }
}

/// The tab was bound to an older AI posture. A conflict, not a refusal: the
/// caller re-reads the policy and retries, and must NOT be shown an approval
/// prompt for it.
pub(super) fn require_current_epoch(
    actual: Option<u64>,
    expected: u64,
) -> Result<(), CommandError> {
    if actual == Some(expected) {
        Ok(())
    } else {
        Err(with_mcp_code(
            localized_error!(ErrorCode::Conflict, "errors.browser.policyStale"),
            "POLICY_STALE",
        ))
    }
}

/// The AI already holds [`MAX_AI_TABS`] live tabs (audit 20260903 X-01). A
/// conflict: closing one lifts it, and no approval can — so no prompt is raised.
/// `detail.limit` carries the bound so the client need not parse the sentence.
pub(super) fn require_ai_tab_capacity(live: usize) -> Result<(), CommandError> {
    if live < MAX_AI_TABS {
        Ok(())
    } else {
        Err(with_mcp_code(
            localized_error!(
                ErrorCode::Conflict,
                "errors.browser.tabLimit",
                limit = MAX_AI_TABS.to_string()
            )
            .with_detail(json!({ "limit": MAX_AI_TABS, "live": live })),
            "TAB_LIMIT",
        ))
    }
}

/// Separate "no such tab" from "that tab belongs to the human". Both were
/// opaque strings before; only the first means the caller should re-discover
/// tabs.
pub(super) fn require_ai_owned(
    mode: Option<AutomationMode>,
) -> Result<AutomationMode, CommandError> {
    match mode {
        Some(AutomationMode::Human) => Err(with_mcp_code(
            localized_error!(ErrorCode::PermissionDenied, "errors.browser.tabNotAiOwned"),
            "TAB_NOT_AI_OWNED",
        )),
        Some(mode) => Ok(mode),
        None => Err(tab_not_found()),
    }
}

pub(super) fn tab_not_found() -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::NotFound, "errors.browser.tabNotFound"),
        "TAB_NOT_FOUND",
    )
}

/// A destination the AI navigation policy refuses outright. Distinct from
/// [`approval_required`] on purpose: no user approval can unblock it, so the
/// frontend must not raise a prompt.
pub(super) fn blocked_destination() -> CommandError {
    with_mcp_code(
        localized_error!(
            ErrorCode::PermissionDenied,
            "errors.browser.blockedDestination"
        )
        .with_detail(json!({ "kind": "ssrf-blocked" })),
        "SSRF_BLOCKED",
    )
}

/// Refused *pending* the user's decision — the frontend raises an approval and
/// retries. This is the value the `includes("APPROVAL_REQUIRED")` sniff was
/// reconstructing from prose.
pub(super) fn approval_required() -> CommandError {
    with_mcp_code(
        localized_error!(
            ErrorCode::ApprovalRequired,
            "errors.browser.approvalRequired"
        ),
        "APPROVAL_REQUIRED",
    )
}

pub(super) fn ai_policy(state: &BrowserSurface) -> Result<AiBrowserPolicy, CommandError> {
    state
        .ai_policy
        .lock()
        .map(|policy| *policy)
        .map_err(lock_failure)
}

/// May a shared-posture tab navigate to `url` without a prompt? Standing
/// `navigate` authority is read from the grants of the WINDOW that owns the tab
/// (audit 20260903 A-03); failing that, a `navigate` one-shot for this exact tab
/// and generation is consumed. An unknown tab has no window and so no grants —
/// default-deny, then the one-shot path.
pub(super) fn authorize_shared_navigation(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    url: &str,
) -> Result<(), CommandError> {
    let window = state
        .registry
        .lock()
        .map_err(lock_failure)?
        .window_of(tab_id)
        .map(str::to_owned);
    if state.is_granted_in_window(window.as_deref(), url, "navigate") {
        return Ok(());
    }
    let mut shots = state.one_shots.lock().map_err(lock_failure)?;
    if one_shot::consume_one_shot(&mut shots, tab_id, generation, url, "navigate", None, None) {
        Ok(())
    } else {
        Err(approval_required())
    }
}

#[cfg(test)]
#[path = "ai_guards.test.rs"]
mod tests;
