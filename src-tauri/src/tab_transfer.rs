//! # Tab Transfer
//!
//! Purpose: Enables dragging tabs between windows by transferring document state
//! through a Rust-side registry, avoiding serialization through the URL or filesystem.
//!
//! Pipeline: Source window detaches tab → `detach_tab_to_new_window` stores data in
//! registry + creates new window → new window calls `claim_tab_transfer` on mount →
//! receives full document state (content, dirty flag, workspace root).
//!
//! Undo (move a tab back): `remove_tab_from_window` is a two-phase handshake, not
//! a fire-and-forget removal — see `TabRemovalAck`.
//!
//! Key decisions:
//!   - Transfer data is stored in a global Mutex<HashMap> keyed by window label,
//!     not passed via URL params, to handle large document content safely.
//!   - `clear_unclaimed_transfer` is called on WindowEvent::Destroyed to prevent
//!     leaks when a window is destroyed before claiming its transfer.
//!   - `find_drop_target_window` uses screen coordinates and prefers focused windows
//!     to support spring-loaded drag targeting.
//!   - Undoing a move is a round trip (`prepare` → `commit`), mirroring the
//!     claim/ack protocol in `workspace_transfer.rs`. `prepare` asks the
//!     destination for the tab's CURRENT state and destroys nothing; the source
//!     restores from that ack (never from its stale pre-transfer snapshot) and
//!     only then sends `commit`, which removes the destination's copy. A
//!     destination that is unreachable or refuses leaves its tab intact and the
//!     undo fails — losing an undo beats losing the user's edits.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::time::{timeout, Duration};

use crate::window_manager;

mod removal;

pub use removal::TabRemovalAck;
use removal::{
    drop_pending_ack, register_pending_ack, route_ack, validate_phase, TabRemovalRequest,
    REMOVAL_ACK_TIMEOUT_MS, REMOVE_ACK_EVENT, REMOVE_EVENT,
};

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

/// Run one phase of the removal handshake against `target_window_label`.
///
/// Returns the destination's ack. Errors (window gone, emit failed, no answer
/// within the timeout) mean *nothing was removed* — the caller must abort the
/// undo rather than assume the tab is gone.
#[tauri::command]
pub async fn remove_tab_from_window(
    app: AppHandle,
    target_window_label: String,
    tab_id: String,
    phase: String,
) -> Result<TabRemovalAck, String> {
    validate_phase(&phase)?;
    let Some(window) = app.get_webview_window(&target_window_label) else {
        return Err(format!("Target window '{}' not found", target_window_label));
    };

    let request_id = format!("tabrm-{}", uuid::Uuid::new_v4());
    let rx = register_pending_ack(&request_id);

    // Listen before emitting so a fast destination cannot answer into the void.
    let listener = app.listen(REMOVE_ACK_EVENT, |event| {
        match serde_json::from_str::<TabRemovalAck>(event.payload()) {
            Ok(ack) => route_ack(ack),
            Err(e) => log::error!("[TabTransfer] Malformed tab-removal ack: {}", e),
        }
    });

    let emitted = window.emit(
        REMOVE_EVENT,
        TabRemovalRequest {
            request_id: request_id.clone(),
            tab_id,
            phase: phase.clone(),
        },
    );
    if let Err(e) = emitted {
        app.unlisten(listener);
        drop_pending_ack(&request_id);
        return Err(e.to_string());
    }

    let result = timeout(Duration::from_millis(REMOVAL_ACK_TIMEOUT_MS), rx).await;
    app.unlisten(listener);
    drop_pending_ack(&request_id);

    match result {
        Ok(Ok(ack)) => Ok(ack),
        Ok(Err(_)) => Err(format!(
            "Window '{}' dropped the tab-removal request",
            target_window_label
        )),
        Err(_) => Err(format!(
            "Timed out waiting for window '{}' to acknowledge tab removal ({})",
            target_window_label, phase
        )),
    }
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
#[path = "tab_transfer.test.rs"]
mod tests;
