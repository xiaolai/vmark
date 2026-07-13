//! Tauri commands for the embedded browser surface (WI-1.2).
//!
//! Thin coordinators: each keeps the `Send` lifecycle registry and the native
//! webview in step. The browser webview itself has NO capability/IPC (it is not
//! a Tauri webview); only these *driver* commands are capability-scoped.

use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::registry::{validate_navigation_url, Lifecycle};
use crate::browser::surface::{self, BrowserSurface};
use tauri::{AppHandle, State};

fn err<E: std::fmt::Debug>(e: E) -> String {
    format!("{e:?}")
}

/// Create a browser tab: register it, construct the native webview, load `url`.
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    window_label: String,
    url: String,
) -> Result<(), String> {
    validate_navigation_url(&url).map_err(err)?;
    {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        reg.create(&tab_id, &window_label).map_err(err)?;
    }
    match surface::create(&app, tab_id.clone(), url) {
        Ok(()) => {
            let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
            let _ = reg.transition(&tab_id, Lifecycle::Live);
            Ok(())
        }
        Err(e) => {
            let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
            reg.remove(&tab_id);
            Err(e)
        }
    }
}

/// Navigate an existing browser tab, bumping its navigation generation (which
/// invalidates in-flight driver commands — R11/WI-1.8).
#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    validate_navigation_url(&url).map_err(err)?;
    {
        let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
        reg.bump_generation(&tab_id).map_err(err)?;
        let _ = reg.transition(&tab_id, Lifecycle::Navigating);
    }
    surface::navigate(&app, tab_id.clone(), url)?;
    let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
    let _ = reg.transition(&tab_id, Lifecycle::Live);
    Ok(())
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
    surface::set_bounds(&app, tab_id, x, y, width, height)
}

/// Destroy a browser tab and tear down its native webview.
#[tauri::command]
pub async fn browser_destroy(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
) -> Result<(), String> {
    surface::destroy(&app, tab_id.clone())?;
    let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
    let _ = reg.transition(&tab_id, Lifecycle::Destroyed);
    reg.remove(&tab_id);
    Ok(())
}

/// Run the SPIKE-1 no-bridge regression check in the browsed page (R3). Returns
/// a JSON object of booleans that must all be false.
#[tauri::command]
pub async fn browser_assert_no_bridge(
    app: AppHandle,
    tab_id: String,
) -> Result<String, String> {
    surface::assert_no_bridge(&app, tab_id)
}

/// Mirror the frontend approval store's standing grants into the driver (WI-2.1).
///
/// The driver's copy is the **authoritative** one: `browser_eval` reads it, so a
/// caller that never syncs simply gets default-deny. Passing an empty vec revokes
/// everything.
#[tauri::command]
pub async fn browser_set_grants(
    state: State<'_, BrowserSurface>,
    grants: Vec<StandingGrant>,
) -> Result<(), String> {
    let mut current = state.grants.lock().map_err(|e| e.to_string())?;
    *current = grants;
    Ok(())
}

/// Evaluate `script` in the driver's isolated content world and return its string
/// result (WI-2.1). The script should `return` a JSON-serializable value.
///
/// **This is the security gate for R4/I3/R7a — the authoritative one.** Callers
/// (the MCP browser tools) also check approval for UX, but that check is advisory:
/// any code path reaching this command is still refused unless all three hold:
///
///   1. `generation` matches the tab's current navigation generation. This closes
///      the TOCTOU where a page navigates between the approval decision and the
///      eval, which would otherwise run an approved script against a *different*
///      origin. A stale command is rejected, never "best-effort" applied.
///   2. The tab has a **committed** top-level URL (R7a). A provisional/in-flight
///      navigation grants nothing — a redirect chain must not briefly authorize an
///      intermediate origin.
///   3. That committed origin grants `operation` (R4/R5). The origin is read from
///      the registry, never from a caller-supplied URL, so a caller cannot assert
///      the origin it wishes it were on.
#[tauri::command]
pub async fn browser_eval(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    script: String,
    operation: String,
    generation: u64,
) -> Result<String, String> {
    {
        let reg = state.registry.lock().map_err(|e| e.to_string())?;

        if !reg.is_command_fresh(&tab_id, generation) {
            return Err(format!(
                "stale command: tab '{tab_id}' navigated or closed since this operation was authorized"
            ));
        }

        // The origin comes from the registry's committed URL — NOT from the caller.
        let committed = reg.committed_url(&tab_id).ok_or_else(|| {
            format!("tab '{tab_id}' has no committed page; nothing is granted yet")
        })?;

        let grants = state.grants.lock().map_err(|e| e.to_string())?;
        if !origin_guard::is_driver_operation_allowed(committed, &operation, &grants) {
            log::warn!(
                "[browser] REFUSED {operation} on {committed} (tab {tab_id}): origin not granted"
            );
            return Err(format!(
                "operation '{operation}' is not granted for the current origin"
            ));
        }
    }

    surface::eval(&app, tab_id, script)
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
