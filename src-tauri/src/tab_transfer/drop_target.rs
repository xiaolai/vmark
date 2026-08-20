//! # Drag drop-targeting
//!
//! Purpose: answer "which window is under the pointer" during a tab drag, and
//! bring that window forward for spring-loaded targeting.
//!
//! Split out of `tab_transfer.rs` to keep it under the file-size gate, and it
//! is a coherent responsibility on its own: screen geometry and window focus,
//! with no knowledge of the transfer payload or its registry.
//!
//! @coordinates-with tab_transfer.rs — the transfer registry and its commands

use crate::command_error::CommandError;
use tauri::{AppHandle, Manager};

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
pub fn focus_existing_window(app: AppHandle, window_label: String) -> Result<(), CommandError> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Err(CommandError::not_found(format!(
            "Window '{window_label}' not found"
        )));
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    window
        .set_focus()
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Pure point-in-rect test for a window's outer bounds (WI-5.4, TQ5).
///
/// A zero-size window is never a drop target. Edges are inclusive — a point
/// exactly on a border counts as inside (matches the original drop behavior).
pub(super) fn point_in_window_rect(
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
