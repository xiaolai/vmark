//! Classifying a native surface failure (audit 20260803 §7), split out of
//! `ai_guards.rs` at the file-size limit. A `#[path]` child of that module, so the
//! function keeps its `ai_guards::surface_failure` address.
//!
//! The vocabulary is [`NativeSurfaceError`] (`native_failure.rs`): the string a
//! native call failed with is parsed to a class once, and [`classify`] is an
//! EXHAUSTIVE match over the enum — a class added there without a decision about
//! its code, key and token no longer compiles into a silent `internal` (round 3,
//! #31; this used to be a nine-way prefix chain). Anything untagged stays
//! `internal`, so an unrecognised failure degrades to today's behavior rather than
//! being guessed at. Every arm's code, kind, i18n key and `mcpCode` is pinned by
//! `ai_guards.test.rs` and `surface_failure.test.rs`.

use crate::browser::ai_guards::with_mcp_code;
use crate::browser::native_failure::NativeSurfaceError;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

/// Classify a native surface failure into the class the caller can actually act
/// on.
///
/// The `detail.kind` names the class so the frontend never has to look at the
/// prose, and `detail.detail` keeps the original text reachable. Three classes also
/// carry the `detail.mcpCode` token the MCP client is promised: `UNSUPPORTED_PLATFORM`
/// (the `browser` tool description names it verbatim — audit 20260903 X-04),
/// `DIALOG_NOT_OWNED`, and `STALE_COMMAND` — a gate refusal that once had to cross
/// the string boundary; `eval` now carries the typed refusal intact
/// (`eval_outcome::EvalError::Refused`), so that arm is the classifier honouring a
/// token in `mod fail`, not the path a refusal takes.
pub(in crate::browser) fn surface_failure(error: &str) -> CommandError {
    let (base, kind, mcp) = classify(NativeSurfaceError::parse(error));
    let classified = base.with_detail(json!({ "kind": kind, "detail": error }));
    match mcp {
        Some(token) => with_mcp_code(classified, token),
        None => classified,
    }
}

/// Class → (translated base error, `detail.kind`, promised `mcpCode`). No wildcard
/// arm: every class decides all three.
fn classify(class: NativeSurfaceError) -> (CommandError, &'static str, Option<&'static str>) {
    use NativeSurfaceError as E;
    match class {
        E::WindowGone => (
            localized_error!(ErrorCode::NotFound, "errors.browser.windowGone"),
            "window-gone",
            None,
        ),
        E::NoWebview => (
            localized_error!(ErrorCode::NotFound, "errors.browser.tabNotFound"),
            "no-webview",
            None,
        ),
        E::InvalidUrl => (
            localized_error!(ErrorCode::InvalidInput, "errors.browser.invalidUrl"),
            "invalid-url",
            None,
        ),
        E::ProfileStoreLimit => (
            localized_error!(ErrorCode::Conflict, "errors.browser.profileLimit"),
            "profile-limit",
            None,
        ),
        E::UnsupportedPlatform => (
            localized_error!(ErrorCode::Unsupported, "errors.browser.unsupportedPlatform"),
            "unsupported-platform",
            Some("UNSUPPORTED_PLATFORM"),
        ),
        E::MainThreadTimeout => (
            localized_error!(ErrorCode::Timeout, "errors.browser.surfaceTimeout"),
            "main-thread-timeout",
            None,
        ),
        E::ContentRulesFailed => (
            localized_error!(ErrorCode::Internal, "errors.browser.contentRulesFailed"),
            "content-rules-failed",
            None,
        ),
        E::StaleCommand => (
            localized_error!(ErrorCode::Conflict, "errors.browser.staleCommand"),
            "stale-command",
            Some("STALE_COMMAND"),
        ),
        E::DialogNotOwned => (
            localized_error!(ErrorCode::PermissionDenied, "errors.browser.dialogNotOwned"),
            "dialog-not-owned",
            Some("DIALOG_NOT_OWNED"),
        ),
        E::Untagged => (
            localized_error!(ErrorCode::Internal, "errors.browser.surfaceFailed"),
            "surface-failed",
            None,
        ),
    }
}

#[cfg(test)]
#[path = "surface_failure.test.rs"]
mod tests;
