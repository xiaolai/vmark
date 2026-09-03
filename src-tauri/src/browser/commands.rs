//! Tauri commands for the embedded browser surface (WI-1.2).
//!
//! Thin coordinators. They own the *edges* of a tab's life — registering it,
//! reserving its terminal state, and dropping its state — and nothing in between:
//! what a load actually does (commit, finish, fail, crash) is known only to the
//! navigation delegate, so the delegate owns every lifecycle write and the
//! navigation generation. A command that guessed at those (forcing `Live`, bumping
//! the generation up front) could only ever be wrong on the failure paths.
//!
//! The browser webview itself has NO capability/IPC (it is not a Tauri webview);
//! only these *driver* commands are capability-scoped, and `browser_eval` is where
//! the origin gate is enforced.

use crate::browser::ai_guards::{
    lock_failure, require_browser_enabled, surface_failure, tab_not_found,
};
use crate::browser::eval_outcome::eval_error;
use crate::browser::registry::{validate_navigation_url, AutomationMode, Lifecycle};
use crate::browser::surface::{self, BrowserSurface};
use crate::command_error::CommandError;
use tauri::{AppHandle, State};

// WI-DP2.1: this module used to flatten every failure with
// `fn err<E: Debug>(e) -> String { format!("{e:?}") }`, which turned a typed
// error into its Debug rendering and lost the class. The frontend then had no
// way to tell "the user must approve this" from "no approval can lift this",
// which is exactly the distinction browserFailure.ts was reconstructing by
// substring match. Each failure below now carries a code from the closed
// vocabulary, reusing the helpers ai_guards.rs already had — `require_browser_enabled`
// for the policy gate (commands.rs was hand-rolling `Err("BROWSER_DISABLED")`
// beside a typed helper for the identical condition), `lock_failure` for a
// poisoned mutex, `surface_failure` for native failures.

/// Create a browser tab: register it, construct the native webview, load `url`.
///
/// The lifecycle from that point on belongs to the navigation delegate — it is
/// the only thing that knows whether the page committed, finished, or failed.
/// Forcing `Live` here (what this command used to do) asserted a page had loaded
/// even when the load failed, timed out, or never started.
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
) -> Result<(), CommandError> {
    {
        let policy = state.ai_policy.lock().map_err(lock_failure)?;
        require_browser_enabled(&policy)?;
    }
    // The window is the INVOKING one, taken from Tauri — not a caller-supplied
    // label. The old signature trusted a `window_label` argument, and the native
    // layer ignored it anyway and attached to `keyWindow()`, so a browser tab
    // could land in the wrong window. Deriving it here fixes both.
    let window_label = webview.label().to_string();
    let url = validate_navigation_url(&url).map_err(CommandError::from)?;
    {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        reg.create(&tab_id, &window_label)?;
        reg.begin_navigation(&tab_id, &url)?;
    }
    if let Err(e) = surface::create(&app, tab_id.clone(), window_label, url) {
        // Roll back BOTH halves of the tab's state — registry entry and crash
        // budget — so a retried tab id starts clean (see `forget_tab`).
        state.forget_tab(&tab_id).map_err(|e| surface_failure(&e))?;
        return Err(surface_failure(&e));
    }
    Ok(())
}

/// Navigate an existing browser tab.
///
/// The navigation generation is bumped by the nav delegate on **commit**, not
/// here: bumping in both places incremented it twice per programmatic navigation,
/// and bumping *before* the native call left a tab whose navigation failed with an
/// advanced generation and a `Navigating` state that nothing would ever clear.
///
/// What this command does own is revoking the committed origin up front (R7a):
/// from the instant a navigation is requested the driver has no authority, and
/// only the next commit re-establishes it. That also doubles as the unknown-tab
/// check, before any native work is attempted.
#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
) -> Result<(), CommandError> {
    {
        let policy = state.ai_policy.lock().map_err(lock_failure)?;
        require_browser_enabled(&policy)?;
    }
    let url = validate_navigation_url(&url).map_err(CommandError::from)?;
    // Snapshot what `begin_navigation` is about to change, so a native failure can
    // put it back. Without this the registry had already cleared the committed
    // authority and moved the lifecycle to Navigating for a load that never
    // started — `browser_ai_navigate` rolled back, this human path did not.
    let (previous_state, previous_committed_url, previous_ticket, previous_shared_origin, ticket) = {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        let previous_state = reg.state(&tab_id).ok_or_else(tab_not_found)?;
        let previous_committed_url = reg.committed_url(&tab_id).map(str::to_owned);
        let previous_ticket = reg.navigation_ticket(&tab_id).cloned();
        let previous_shared_origin = reg.shared_navigation_origin(&tab_id);
        let ticket = reg.begin_navigation(&tab_id, &url)?;
        // This command is the user's omnibox path, including when the tab was
        // originally created in shared AI posture. The native delegate must
        // not reinterpret that explicit human navigation as an AI destination
        // requiring a separate approval prompt.
        if reg.automation_mode(&tab_id) == Some(AutomationMode::AiShared) {
            reg.set_shared_navigation_approval(&tab_id, &url)?;
        }
        (
            previous_state,
            previous_committed_url,
            previous_ticket,
            previous_shared_origin,
            ticket,
        )
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
    Ok(())
}

/// Go back in the tab's history. The nav delegate reports the resulting load,
/// so the address bar and generation stay in step without extra bookkeeping here.
#[tauri::command]
pub async fn browser_back(app: AppHandle, tab_id: String) -> Result<(), CommandError> {
    surface::go_history(&app, tab_id, false).map_err(|e| surface_failure(&e))
}

/// Go forward in the tab's history.
#[tauri::command]
pub async fn browser_forward(app: AppHandle, tab_id: String) -> Result<(), CommandError> {
    surface::go_history(&app, tab_id, true).map_err(|e| surface_failure(&e))
}

/// Stop the tab's current load.
#[tauri::command]
pub async fn browser_stop(app: AppHandle, tab_id: String) -> Result<(), CommandError> {
    surface::stop(&app, tab_id).map_err(|e| surface_failure(&e))
}

/// Answer a page `confirm()` dialog surfaced via `browser://dialog` (WI-1.7).
///
/// Only the window that OWNS the dialog's tab may answer it (audit 20260903): the
/// window is the invoking one, taken from Tauri, and the native layer refuses
/// (`DIALOG_NOT_OWNED`) when the parked dialog's tab belongs to another window —
/// a dialog id is a small integer, and a guessed one must not answer a page the
/// caller cannot even see.
#[tauri::command]
pub async fn browser_dialog_respond(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    id: u64,
    accepted: bool,
) -> Result<(), CommandError> {
    let window_label = webview.label().to_string();
    surface::dialog_respond(&app, id, accepted, window_label).map_err(|e| surface_failure(&e))
}

/// Reject a rect the native layer cannot honour.
///
/// The numbers come straight from a JS `getBoundingClientRect()` over IPC, which
/// yields NaN/∞ for a detached or degenerately-transformed node. A NaN `CGRect`
/// is not an error to AppKit — it lays the view out at an undefined position, so
/// the page silently ends up invisible or unclickable with nothing logged. A
/// negative extent is not a rectangle at all. Both are cheap to refuse here.
pub(crate) fn validate_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), CommandError> {
    if !(x.is_finite() && y.is_finite() && width.is_finite() && height.is_finite()) {
        // NOT localized: a NaN/∞ rect is a CALLER bug (a detached node's
        // getBoundingClientRect), never something a user did or can read. Rule
        // 50 §10 reserves i18nKey for user-facing prose; an internal message
        // that resolved in ten bundles would be ten translations of a
        // programmer error.
        return Err(CommandError::invalid_input(format!(
            "invalid browser bounds: non-finite rect (x={x}, y={y}, w={width}, h={height})"
        )));
    }
    if width < 0.0 || height < 0.0 {
        return Err(CommandError::invalid_input(format!(
            "invalid browser bounds: negative extent (w={width}, h={height})"
        )));
    }
    Ok(())
}

/// Reposition/resize the native webview to match the React pane rect (points).
#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), CommandError> {
    validate_bounds(x, y, width, height)?;
    surface::set_bounds(&app, tab_id, x, y, width, height).map_err(|e| surface_failure(&e))
}

/// Destroy a browser tab and tear down its native webview.
///
/// The terminal state is **reserved before** the native teardown, not after: from
/// that moment `is_command_fresh` refuses every driver command for this tab, so a
/// concurrent `browser_eval` cannot be dispatched against a webview that is on its
/// way out. Idempotent — a second destroy (or one for an unknown tab) is a no-op.
#[tauri::command]
pub async fn browser_destroy(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
) -> Result<(), CommandError> {
    let known = {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        match reg.state(&tab_id) {
            // Unknown, or a concurrent destroy already claimed it. The NATIVE side
            // is still asked to tear down below: a creation that finished after a
            // registry rollback or timeout left a live WKWebView the registry never
            // recorded, and returning here made it unremovable.
            None => false,
            Some(s) if s.is_terminal() => true,
            Some(_) => {
                reg.transition(&tab_id, Lifecycle::Destroyed)?;
                true
            }
        }
    };
    let native = surface::destroy(&app, tab_id.clone());
    if !known {
        // Nothing to forget in the registry; the native teardown is idempotent
        // (a tab with no view is a no-op), so an unknown tab is simply done.
        return native.map_err(|e| surface_failure(&e));
    }
    let teardown = native.map_err(|e| surface_failure(&e));
    // The tab is terminal either way, so its state goes regardless of how the
    // native teardown fared: a native failure here means the main thread is gone
    // (app shutting down), and keeping a dead entry would leak it forever.
    state.forget_tab(&tab_id).map_err(|e| surface_failure(&e))?;
    teardown
}

/// Run the SPIKE-1 no-bridge regression check in the browsed page (R3). Returns
/// a JSON object of booleans that must all be false.
#[tauri::command]
pub async fn browser_assert_no_bridge(
    app: AppHandle,
    tab_id: String,
) -> Result<String, CommandError> {
    surface::assert_no_bridge(&app, tab_id).map_err(eval_error)
}

/// Tab ids holding a live native webview (debug builds only).
///
/// Exists for E2E: the native view is a sibling of the Tauri webview and shows up
/// in no DOM snapshot, so without this an E2E teardown assertion can only observe
/// the React surface and would pass while the `WKWebView` leaked (matrix B11).
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn browser_debug_native_tab_ids(app: AppHandle) -> Result<Vec<String>, CommandError> {
    surface::debug_native_tab_ids(&app).map_err(|e| surface_failure(&e))
}

/// How many `WKWebView`s are attached to the window hierarchy (debug builds only).
///
/// The real teardown oracle: the bookkeeping map is emptied BEFORE
/// `removeFromSuperview()`, so a map-based check cannot see a view that outlived
/// its entry. This walks the hierarchy.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn browser_debug_attached_webviews(
    app: AppHandle,
    window_label: String,
) -> Result<usize, CommandError> {
    surface::debug_attached_webviews(&app, window_label).map_err(|e| surface_failure(&e))
}

/// Does the tab's native webview occlude a window point? (debug builds only)
///
/// The occlusion oracle for E2E (matrix B14). Not a read-back of the freeze flag —
/// it asks AppKit's `hitTest:`, which walks the real hierarchy and skips hidden
/// views, so it answers through a path independent of the one that set the flag.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn browser_debug_hit_test(
    app: AppHandle,
    tab_id: String,
    window_label: String,
    x: f64,
    y: f64,
) -> Result<serde_json::Value, CommandError> {
    let (occludes, found) = surface::debug_hit_test(&app, tab_id, window_label, x, y)
        .map_err(|e| surface_failure(&e))?;
    Ok(serde_json::json!({ "occludes": occludes, "found": found }))
}

/// Freeze the browser tab — hide the native view so a DOM overlay paints over
/// the rect instead of the live page (R2/WI-1.4 occlusion).
#[tauri::command]
pub async fn browser_freeze(app: AppHandle, tab_id: String) -> Result<(), CommandError> {
    surface::set_hidden(&app, tab_id, true).map_err(|e| surface_failure(&e))
}

/// Thaw the browser tab — show the native view again.
#[tauri::command]
pub async fn browser_thaw(app: AppHandle, tab_id: String) -> Result<(), CommandError> {
    surface::set_hidden(&app, tab_id, false).map_err(|e| surface_failure(&e))
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
