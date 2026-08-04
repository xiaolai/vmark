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
//! @module browser::ai_guards

use crate::browser::ai_policy::{AiBrowserPolicy, AiSessionMode, AiUrlError};
use crate::browser::one_shot;
use crate::browser::origin_guard::is_operation_granted;
use crate::browser::registry::AutomationMode;
use crate::browser::surface::BrowserSurface;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

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

/// Does `error` begin with `token` as a whole tag (`TOKEN` or `TOKEN: …`)?
///
/// Anchored and delimited on purpose: a bare `contains()` would let a URL
/// carrying the token in its query string reclassify its own failure, which is
/// precisely the substring-sniff defect WI-14 exists to remove.
fn tagged(error: &str, token: &str) -> bool {
    match error.strip_prefix(token) {
        Some("") => true,
        Some(rest) => rest.starts_with(':'),
        None => false,
    }
}

/// Classify a native surface failure — `surface::create_with_mode`,
/// `surface::navigate` — into the class the caller can actually act on.
///
/// Reads the stable tokens in [`crate::browser::surface::fail`]; anything
/// unrecognised stays `internal`, so an untagged failure degrades to today's
/// behavior rather than being guessed at. The `detail.kind` names the tag so
/// the frontend never has to look at the prose.
pub(super) fn surface_failure(error: &str) -> CommandError {
    use crate::browser::surface::fail;
    let (code, key, kind) = if tagged(error, fail::WINDOW_GONE) {
        (
            ErrorCode::NotFound,
            "errors.browser.windowGone",
            "window-gone",
        )
    } else if tagged(error, fail::NO_WEBVIEW) {
        (
            ErrorCode::NotFound,
            "errors.browser.tabNotFound",
            "no-webview",
        )
    } else if tagged(error, fail::INVALID_URL) {
        (
            ErrorCode::InvalidInput,
            "errors.browser.invalidUrl",
            "invalid-url",
        )
    } else if tagged(error, fail::PROFILE_STORE_LIMIT) {
        (
            ErrorCode::Conflict,
            "errors.browser.profileLimit",
            "profile-limit",
        )
    } else if tagged(error, fail::UNSUPPORTED_PLATFORM) {
        (
            ErrorCode::Unsupported,
            "errors.browser.unsupportedPlatform",
            "unsupported-platform",
        )
    } else if tagged(error, fail::MAIN_THREAD_TIMEOUT) {
        (
            ErrorCode::Timeout,
            "errors.browser.surfaceTimeout",
            "main-thread-timeout",
        )
    } else {
        (
            ErrorCode::Internal,
            "errors.browser.surfaceFailed",
            "surface-failed",
        )
    };
    CommandError::new(code, rust_i18n::t!(key))
        .with_i18n_key(key)
        .with_detail(json!({ "kind": kind, "detail": error }))
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

pub(super) fn authorize_shared_navigation(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    url: &str,
) -> Result<(), CommandError> {
    let grants = state.grants.lock().map_err(lock_failure)?;
    if is_operation_granted(url, "navigate", &grants) {
        return Ok(());
    }
    drop(grants);
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
