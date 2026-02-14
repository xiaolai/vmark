//! # Tab Transfer
//!
//! Purpose: Enables dragging tabs between windows by transferring document state
//! through a Rust-side registry, avoiding serialization through the URL or filesystem.
//!
//! Pipeline: Source window detaches tab → `detach_tab_to_new_window` stores data in
//! registry + creates new window → new window calls `claim_tab_transfer` on mount →
//! receives full document state (content, dirty flag, workspace root).
//!
//! Key decisions:
//!   - Transfer data is stored in a global Mutex<HashMap> keyed by window label,
//!     not passed via URL params, to handle large document content safely.
//!   - `clear_unclaimed_transfer` is called on WindowEvent::Destroyed to prevent
//!     leaks when a window is destroyed before claiming its transfer.
//!   - `find_drop_target_window` uses screen coordinates and prefers focused windows
//!     to support spring-loaded drag targeting.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::window_manager;

/// Data transferred when a tab is dragged out to a new window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabTransferData {
    pub tab_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub content: String,
    pub saved_content: String,
    pub is_dirty: bool,
    pub workspace_root: Option<String>,
}

/// Registry of pending tab transfers, keyed by target window label.
static TRANSFER_REGISTRY: Mutex<Option<HashMap<String, TabTransferData>>> = Mutex::new(None);

fn registry() -> std::sync::MutexGuard<'static, Option<HashMap<String, TabTransferData>>> {
    TRANSFER_REGISTRY.lock().unwrap()
}

/// Create a new window and store transfer data for it.
/// Returns the new window label.
#[tauri::command]
pub fn detach_tab_to_new_window(app: AppHandle, data: TabTransferData) -> Result<String, String> {
    let label =
        window_manager::create_document_window_for_transfer(&app).map_err(|e| e.to_string())?;

    let mut guard = registry();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(label.clone(), data);

    Ok(label)
}

/// Transfer a tab directly to an existing window.
/// The target window receives a `tab:transfer` event with full payload.
#[tauri::command]
pub fn transfer_tab_to_existing_window(
    app: AppHandle,
    target_window_label: String,
    data: TabTransferData,
) -> Result<(), String> {
    let Some(target_window) = app.get_webview_window(&target_window_label) else {
        return Err(format!("Target window '{}' not found", target_window_label));
    };

    target_window
        .emit("tab:transfer", data)
        .map_err(|e| e.to_string())
}

/// Find a document window at the given screen coordinates.
/// Returns `None` when no other document window contains the point.
#[tauri::command]
pub fn find_drop_target_window(
    app: AppHandle,
    source_window_label: String,
    screen_x: f64,
    screen_y: f64,
) -> Option<String> {
    let windows = app.webview_windows();
    let mut focused_match: Option<String> = None;
    let mut fallback_match: Option<String> = None;

    for (label, window) in windows {
        if label == source_window_label {
            continue;
        }
        if label != "main" && !label.starts_with("doc-") {
            continue;
        }

        let Ok(position) = window.outer_position() else {
            continue;
        };
        let Ok(size) = window.outer_size() else {
            continue;
        };
        if size.width == 0 || size.height == 0 {
            continue;
        }

        let left = position.x as f64;
        let top = position.y as f64;
        let right = left + size.width as f64;
        let bottom = top + size.height as f64;
        let contains =
            screen_x >= left && screen_x <= right && screen_y >= top && screen_y <= bottom;

        if contains {
            let is_focused = window.is_focused().unwrap_or(false);
            if is_focused {
                focused_match = Some(label.clone());
                break;
            }
            if fallback_match.is_none() {
                fallback_match = Some(label.clone());
            }
        }
    }

    focused_match.or(fallback_match)
}

/// Focus an existing window by label (used for spring-loaded drag targeting).
#[tauri::command]
pub fn focus_existing_window(app: AppHandle, window_label: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Err(format!("Window '{}' not found", window_label));
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    window.set_focus().map_err(|e| e.to_string())
}

/// Ask a target window to remove a transferred tab by id.
#[tauri::command]
pub fn remove_tab_from_window(
    app: AppHandle,
    target_window_label: String,
    tab_id: String,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&target_window_label) else {
        return Err(format!("Target window '{}' not found", target_window_label));
    };
    window
        .emit("tab:remove-by-id", serde_json::json!({ "tabId": tab_id }))
        .map_err(|e| e.to_string())
}

/// Claim transfer data for a window. Returns the data and removes it from the registry.
#[tauri::command]
pub fn claim_tab_transfer(window_label: String) -> Option<TabTransferData> {
    let mut guard = registry();
    guard.as_mut().and_then(|map| map.remove(&window_label))
}

/// Remove any unclaimed transfer data for a window that was destroyed.
/// Called from the `WindowEvent::Destroyed` handler to prevent leaks.
pub fn clear_unclaimed_transfer(window_label: &str) {
    let mut guard = registry();
    if let Some(map) = guard.as_mut() {
        map.remove(window_label);
    }
}
