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

/// Document state transferred when a tab is dragged between windows.
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
    TRANSFER_REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
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

        if point_in_window_rect(
            position.x,
            position.y,
            size.width,
            size.height,
            screen_x,
            screen_y,
        ) {
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

/// Pure point-in-rect test for a window's outer bounds (WI-5.4, TQ5).
///
/// A zero-size window is never a drop target. Edges are inclusive — a point
/// exactly on a border counts as inside (matches the original drop behavior).
fn point_in_window_rect(
    pos_x: i32,
    pos_y: i32,
    width: u32,
    height: u32,
    screen_x: f64,
    screen_y: f64,
) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    let left = pos_x as f64;
    let top = pos_y as f64;
    let right = left + width as f64;
    let bottom = top + height as f64;
    screen_x >= left && screen_x <= right && screen_y >= top && screen_y <= bottom
}

#[cfg(test)]
mod tests {
    use super::point_in_window_rect;

    #[test]
    fn point_inside_rect() {
        // window at (100,100) size 800x600 → (500,400) is inside.
        assert!(point_in_window_rect(100, 100, 800, 600, 500.0, 400.0));
    }

    #[test]
    fn point_on_edge_is_inside() {
        // Top-left and bottom-right corners are inclusive.
        assert!(point_in_window_rect(100, 100, 800, 600, 100.0, 100.0));
        assert!(point_in_window_rect(100, 100, 800, 600, 900.0, 700.0));
    }

    #[test]
    fn point_outside_rect() {
        assert!(!point_in_window_rect(100, 100, 800, 600, 50.0, 400.0)); // left of
        assert!(!point_in_window_rect(100, 100, 800, 600, 901.0, 400.0)); // right of
        assert!(!point_in_window_rect(100, 100, 800, 600, 500.0, 99.0)); // above
        assert!(!point_in_window_rect(100, 100, 800, 600, 500.0, 701.0)); // below
    }

    #[test]
    fn zero_size_window_never_matches() {
        assert!(!point_in_window_rect(100, 100, 0, 600, 100.0, 100.0));
        assert!(!point_in_window_rect(100, 100, 800, 0, 100.0, 100.0));
    }

    #[test]
    fn negative_origin_window() {
        // Windows can sit at negative coords on a multi-monitor setup.
        assert!(point_in_window_rect(-200, -100, 400, 300, -50.0, 50.0));
        assert!(!point_in_window_rect(-200, -100, 400, 300, 300.0, 50.0));
    }
}
