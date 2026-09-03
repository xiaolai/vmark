//! Classifying a native surface failure (audit 20260803 §7), split out of
//! `ai_guards.rs` at the file-size limit. A `#[path]` child of that module, so
//! the function keeps its `ai_guards::surface_failure` address.
//!
//! `surface::create_with_mode`, `surface::navigate`, `surface::dialog_respond`
//! and the rest of the native API are `Result<_, String>` on every platform; the
//! stable tokens in [`crate::browser::surface::fail`] are the only structure those
//! strings carry, and this is the one place that reads them. Anything
//! unrecognised stays `internal`, so an untagged failure degrades to today's
//! behavior rather than being guessed at.

use crate::browser::ai_guards::with_mcp_code;
use crate::browser::surface::fail;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

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

/// Classify a native surface failure into the class the caller can actually act
/// on.
///
/// The `detail.kind` names the tag so the frontend never has to look at the prose,
/// and `detail.detail` keeps the original text reachable. Two tags also carry the
/// `detail.mcpCode` token the MCP client is promised: `UNSUPPORTED_PLATFORM`
/// (the `browser` tool description names it verbatim — audit 20260903 X-04) and
/// `DIALOG_NOT_OWNED`.
pub(in crate::browser) fn surface_failure(error: &str) -> CommandError {
    let (base, kind, mcp) = if tagged(error, fail::WINDOW_GONE) {
        (
            localized_error!(ErrorCode::NotFound, "errors.browser.windowGone"),
            "window-gone",
            None,
        )
    } else if tagged(error, fail::NO_WEBVIEW) {
        (
            localized_error!(ErrorCode::NotFound, "errors.browser.tabNotFound"),
            "no-webview",
            None,
        )
    } else if tagged(error, fail::INVALID_URL) {
        (
            localized_error!(ErrorCode::InvalidInput, "errors.browser.invalidUrl"),
            "invalid-url",
            None,
        )
    } else if tagged(error, fail::PROFILE_STORE_LIMIT) {
        (
            localized_error!(ErrorCode::Conflict, "errors.browser.profileLimit"),
            "profile-limit",
            None,
        )
    } else if tagged(error, fail::UNSUPPORTED_PLATFORM) {
        (
            localized_error!(ErrorCode::Unsupported, "errors.browser.unsupportedPlatform"),
            "unsupported-platform",
            Some("UNSUPPORTED_PLATFORM"),
        )
    } else if tagged(error, fail::MAIN_THREAD_TIMEOUT) {
        (
            localized_error!(ErrorCode::Timeout, "errors.browser.surfaceTimeout"),
            "main-thread-timeout",
            None,
        )
    } else if tagged(error, fail::CONTENT_RULES_FAILED) {
        (
            localized_error!(ErrorCode::Internal, "errors.browser.contentRulesFailed"),
            "content-rules-failed",
            None,
        )
    } else if tagged(error, fail::STALE_COMMAND) {
        (
            localized_error!(ErrorCode::Conflict, "errors.browser.staleCommand"),
            "stale-command",
            Some("STALE_COMMAND"),
        )
    } else if tagged(error, fail::DIALOG_NOT_OWNED) {
        (
            localized_error!(ErrorCode::PermissionDenied, "errors.browser.dialogNotOwned"),
            "dialog-not-owned",
            Some("DIALOG_NOT_OWNED"),
        )
    } else {
        (
            localized_error!(ErrorCode::Internal, "errors.browser.surfaceFailed"),
            "surface-failed",
            None,
        )
    };
    let classified = base.with_detail(json!({ "kind": kind, "detail": error }));
    match mcp {
        Some(token) => with_mcp_code(classified, token),
        None => classified,
    }
}
