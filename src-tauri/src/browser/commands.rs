//! Tauri commands for the embedded browser surface (WI-1.2).
//!
//! Thin coordinators: each keeps the `Send` lifecycle registry and the native
//! webview in step. The browser webview itself has NO capability/IPC (it is not
//! a Tauri webview); only these *driver* commands are capability-scoped.

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
