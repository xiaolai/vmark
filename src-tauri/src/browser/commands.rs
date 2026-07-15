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

use crate::browser::registry::{validate_navigation_url, AutomationMode, Lifecycle};
use crate::browser::surface::{self, BrowserSurface};
use tauri::{AppHandle, State};

fn err<E: std::fmt::Debug>(e: E) -> String {
    format!("{e:?}")
}

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
) -> Result<(), String> {
    if !state.ai_policy.lock().map_err(|e| e.to_string())?.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    // The window is the INVOKING one, taken from Tauri — not a caller-supplied
    // label. The old signature trusted a `window_label` argument, and the native
    // layer ignored it anyway and attached to `keyWindow()`, so a browser tab
    // could land in the wrong window. Deriving it here fixes both.
    let window_label = webview.label().to_string();
    let url = validate_navigation_url(&url).map_err(err)?;
    {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        reg.create(&tab_id, &window_label).map_err(err)?;
        reg.begin_navigation(&tab_id, &url).map_err(err)?;
    }
    if let Err(e) = surface::create(&app, tab_id.clone(), window_label, url) {
        // Roll back BOTH halves of the tab's state — registry entry and crash
        // budget — so a retried tab id starts clean (see `forget_tab`).
        state.forget_tab(&tab_id)?;
        return Err(e);
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
) -> Result<(), String> {
    if !state.ai_policy.lock().map_err(|e| e.to_string())?.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    let url = validate_navigation_url(&url).map_err(err)?;
    {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        reg.begin_navigation(&tab_id, &url).map_err(err)?;
        // This command is the user's omnibox path, including when the tab was
        // originally created in shared AI posture. The native delegate must
        // not reinterpret that explicit human navigation as an AI destination
        // requiring a separate approval prompt.
        if reg.automation_mode(&tab_id) == Some(AutomationMode::AiShared) {
            reg.set_shared_navigation_approval(&tab_id, &url).map_err(err)?;
        }
    }
    surface::navigate(&app, tab_id, url)
}

/// Go back in the tab's history. The nav delegate reports the resulting load,
/// so the address bar and generation stay in step without extra bookkeeping here.
#[tauri::command]
pub async fn browser_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    surface::go_history(&app, tab_id, false)
}

/// Go forward in the tab's history.
#[tauri::command]
pub async fn browser_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    surface::go_history(&app, tab_id, true)
}

/// Stop the tab's current load.
#[tauri::command]
pub async fn browser_stop(app: AppHandle, tab_id: String) -> Result<(), String> {
    surface::stop(&app, tab_id)
}

/// Answer a page `confirm()` dialog surfaced via `browser://dialog` (WI-1.7).
#[tauri::command]
pub async fn browser_dialog_respond(app: AppHandle, id: u64, accepted: bool) -> Result<(), String> {
    surface::dialog_respond(&app, id, accepted)
}

/// Reject a rect the native layer cannot honour.
///
/// The numbers come straight from a JS `getBoundingClientRect()` over IPC, which
/// yields NaN/∞ for a detached or degenerately-transformed node. A NaN `CGRect`
/// is not an error to AppKit — it lays the view out at an undefined position, so
/// the page silently ends up invisible or unclickable with nothing logged. A
/// negative extent is not a rectangle at all. Both are cheap to refuse here.
pub(crate) fn validate_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !(x.is_finite() && y.is_finite() && width.is_finite() && height.is_finite()) {
        return Err(format!(
            "invalid browser bounds: non-finite rect (x={x}, y={y}, w={width}, h={height})"
        ));
    }
    if width < 0.0 || height < 0.0 {
        return Err(format!(
            "invalid browser bounds: negative extent (w={width}, h={height})"
        ));
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
) -> Result<(), String> {
    validate_bounds(x, y, width, height)?;
    surface::set_bounds(&app, tab_id, x, y, width, height)
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
) -> Result<(), String> {
    {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        match reg.state(&tab_id) {
            // Unknown, or a concurrent destroy already claimed it.
            None => return Ok(()),
            Some(s) if s.is_terminal() => {}
            Some(_) => reg.transition(&tab_id, Lifecycle::Destroyed).map_err(err)?,
        }
    }
    let teardown = surface::destroy(&app, tab_id.clone());
    // The tab is terminal either way, so its state goes regardless of how the
    // native teardown fared: a native failure here means the main thread is gone
    // (app shutting down), and keeping a dead entry would leak it forever.
    state.forget_tab(&tab_id)?;
    teardown
}

/// Run the SPIKE-1 no-bridge regression check in the browsed page (R3). Returns
/// a JSON object of booleans that must all be false.
#[tauri::command]
pub async fn browser_assert_no_bridge(app: AppHandle, tab_id: String) -> Result<String, String> {
    surface::assert_no_bridge(&app, tab_id)
}

/// Freeze the browser tab — hide the native view so a DOM overlay paints over
/// the rect instead of the live page (R2/WI-1.4 occlusion).
#[tauri::command]
pub async fn browser_freeze(app: AppHandle, tab_id: String) -> Result<(), String> {
    surface::set_hidden(&app, tab_id, true)
}

/// Thaw the browser tab — show the native view again.
#[tauri::command]
pub async fn browser_thaw(app: AppHandle, tab_id: String) -> Result<(), String> {
    surface::set_hidden(&app, tab_id, false)
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
