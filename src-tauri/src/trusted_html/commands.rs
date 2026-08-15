//! The IPC surface over the trusted-HTML grant registry.
//!
//! Thin by design: every rule lives in `state.rs`, so there is one place where
//! "a grant only comes from an explicit authorization" is decided. These
//! commands exist to move a decision the USER already made across the process
//! boundary — they never decide anything themselves.
//!
//! Each grant is attributed to the window that asked for it, taken from the
//! `Window` the runtime supplies rather than from any argument the caller
//! controls. That is what makes `revoke_window` on window teardown correct.
//!
//! @coordinates-with state.rs — the registry these delegate to
//! @coordinates-with ../app_setup.rs — window teardown calls `revoke_window`
//! @coordinates-with ../../../src/services/trustedHtml/trustedHtmlBridge.ts — the caller

use tauri::State;

use crate::command_error::CommandError;

use super::state::TrustedHtmlState;

/// Authorize `html` for execution and return the token that serves it.
///
/// Called only from the frontend's explicit-confirmation path. Nothing here
/// checks a file extension or a path, because trust never follows from
/// either (issue #1273 requirement 10).
/// Generic over the runtime so it can be exercised under `MockRuntime`: the
/// window label is the whole point of this command, and a signature pinned to
/// Wry would leave that attribution testable only in a real app.
#[tauri::command]
pub fn trusted_html_grant<R: tauri::Runtime>(
    window: tauri::Window<R>,
    state: State<'_, TrustedHtmlState>,
    html: String,
) -> Result<String, CommandError> {
    state.grant(window.label(), html)
}

/// Replace the document behind an already-granted token — the "Reload" action
/// on a trusted preview, after the user edited the source.
///
/// Refuses an unknown token rather than creating one, so this can never be the
/// step that authorizes something.
#[tauri::command]
pub fn trusted_html_publish(
    state: State<'_, TrustedHtmlState>,
    token: String,
    html: String,
) -> Result<(), CommandError> {
    state.publish(&token, html)
}

/// Revoke one grant. Idempotent: revoking an already-dead token succeeds, so
/// a revoke racing a window teardown is not an error the user has to see.
#[tauri::command]
pub fn trusted_html_revoke(state: State<'_, TrustedHtmlState>, token: String) {
    state.revoke(&token);
}

// There is deliberately NO process-global revoke command. One existed here,
// wired to nothing, and it was unsafe to wire as its own documentation
// described: with no owner recorded, a global sweep fired on one window's
// teardown would have revoked every OTHER window's trusted previews. Ownership
// now lives on the grant, and teardown goes through
// `TrustedHtmlState::revoke_window` from the native window-destroy handler.

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
