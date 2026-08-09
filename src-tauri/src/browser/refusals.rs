//! The authorization gate's refusal vocabulary (WI-DP2.3, split out WI-DP4.1).
//!
//! Purpose: one place that names every way `authorize_driver_op` can say no, so
//! the gate itself stays small enough to read in one screen — the same reason
//! `authorize.rs` was split out of `commands_auth.rs`.
//!
//! @coordinates-with browser/authorize.rs — the gate that raises these
//! @coordinates-with browser/ai_guards.rs — `with_mcp_code`, the MCP token shim

use crate::browser::ai_guards::with_mcp_code;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

// WI-DP2.3 — the gate's refusal vocabulary, typed.
//
// BEHAVIOUR IS PRESERVED EXACTLY, and that constraint drove the codes. None of
// these refusals raised an approval prompt before: they were bare strings, so
// `parseCommandError` returned null and `needsNavigationApproval` fell through
// to a substring test for `APPROVAL_REQUIRED` that none of them contained.
// Mapping any of them to `approval-required` would therefore START prompting
// where VMark previously refused outright — a UX change smuggled in under a
// typing change. So they are `permission-denied` and `conflict`, and the day one
// of them SHOULD prompt, that becomes a deliberate edit with its own reasoning.
//
// The mcpCode on each keeps the token shipped MCP clients already match on.

/// The tab moved on between authorization and execution. A conflict, not a
/// refusal: nothing is wrong with the caller's authority, the world changed.
pub(crate) fn stale_command(tab_id: &str, when: &str) -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::Conflict, "errors.browser.staleCommand")
            .with_detail(serde_json::json!({ "tabId": tab_id, "when": when })),
        "STALE_COMMAND",
    )
}

/// Executable and fresh, but nothing has committed — so there is no origin to
/// grant anything against yet.
pub(crate) fn no_committed_page(tab_id: &str) -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::Conflict, "errors.browser.noCommittedPage")
            .with_detail(serde_json::json!({ "tabId": tab_id })),
        "NO_COMMITTED_PAGE",
    )
}

/// A profile-backed tab that has left its approved origin. HARD denial — the
/// page carries the profile's real login, and the comment at the call site is
/// explicit that not even a one-shot may rescue it. `permission-denied` is the
/// code that says "no approval lifts this".
pub(crate) fn profile_origin_confined() -> CommandError {
    with_mcp_code(
        localized_error!(
            ErrorCode::PermissionDenied,
            "errors.browser.profileOriginConfined"
        ),
        "PROFILE_ORIGIN_CONFINED",
    )
}

/// A human tab needs an ephemeral attachment for EVERY operation. Semantically
/// this is user-liftable, but it did not prompt before and does not now — see
/// the note above.
pub(crate) fn attachment_required() -> CommandError {
    with_mcp_code(
        localized_error!(
            ErrorCode::PermissionDenied,
            "errors.browser.attachmentRequired"
        ),
        "ATTACHMENT_REQUIRED",
    )
}

/// No standing authority and no one-shot matched.
pub(crate) fn not_granted(operation: &str) -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::PermissionDenied, "errors.browser.notGranted")
            .with_detail(serde_json::json!({ "operation": operation })),
        "NOT_GRANTED",
    )
}
