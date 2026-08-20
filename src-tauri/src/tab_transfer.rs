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
//! Submodules (split out to stay under the file-size gate, each a coherent
//! responsibility rather than an arbitrary slice):
//!   - `drop_target` — which window is under the pointer, and focusing it
//!   - `removal` — the undo handshake's wire contract and pending-ack registry
//!
//! Key decisions:
//!   - Transfer data is stored in a global Mutex<HashMap> keyed by window label,
//!     not passed via URL params, to handle large document content safely.
//!   - The payload is registered BEFORE the window is created, and a failed
//!     build rolls the entry back. The target claims on mount, so the reverse
//!     order is a gap in which a claim finds nothing and the window opens
//!     empty — invisible while the command was blocking (one thread did both),
//!     real once it became `(async)` for #1301.
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
//!   - The payload carries the FILE's line convention (`line_ending`,
//!     `hard_break_style`, `has_bom`, `last_disk_content`) alongside its
//!     content. `content`/`saved_content` are canonical editor text — LF and
//!     BOM-free — so without these a CRLF+BOM file was rewritten LF and
//!     BOM-less on its first save in the destination window. All four are
//!     optional: a payload from an older build has none and the receiver falls
//!     back to detection, as it did for every payload before.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::time::{timeout, Duration};

use crate::window_manager;

mod drop_target;
mod removal;

// GLOB, not a named re-export: `#[tauri::command]` also emits a sibling
// `__cmd__<name>` macro, and `generate_handler!` resolves it through the same
// path as the function. A named `pub use` moves the fn and leaves the macro
// behind, so `command_registry.rs` stops compiling — the same reason
// `window_manager/mod.rs` re-exports its submodules with `*`.
pub use drop_target::*;
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
    /// Line convention the FILE has on disk. Canonical LF content cannot carry
    /// it, so a transfer that omitted these rewrote a CRLF+BOM file to LF and
    /// BOM-less on its first save in the destination window. `Option` because
    /// payloads written by older builds have none — the receiver then falls
    /// back to detection, which is what it did for every payload before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_ending: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hard_break_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_bom: Option<bool>,
    /// RAW disk bytes, so external-change detection in the destination compares
    /// against what is actually on disk rather than the canonical editor text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_disk_content: Option<String>,
}

/// The route a detached window loads; `?transfer=true` is what makes its
/// frontend claim the payload registered for its label.
const TRANSFER_URL: &str = "/?transfer=true";

/// Registry of pending tab transfers, keyed by target window label.
static TRANSFER_REGISTRY: Mutex<Option<HashMap<String, TabTransferData>>> = Mutex::new(None);

fn registry() -> std::sync::MutexGuard<'static, Option<HashMap<String, TabTransferData>>> {
    TRANSFER_REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
}

/// Create a new window and store transfer data for it.
/// Returns the new window label.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn detach_tab_to_new_window(
    app: AppHandle,
    data: TabTransferData,
) -> Result<String, CommandError> {
    // Register the payload BEFORE creating the window — the ordering
    // `workspace_transfer.rs` already documents, and the reason it gives holds
    // here verbatim: the target invokes `claim_tab_transfer` on mount, and a
    // claim that arrives before the registry is populated silently opens an
    // EMPTY window with the user's tab nowhere.
    //
    // Under the old blocking command that could not happen — the insert ran on
    // the same main thread that had to return to its loop before the new
    // webview could execute any JS. `(async)` (#1301) moved the insert to a
    // runtime worker, so "create, then register" became a real check-then-act
    // gap. Registering first cannot lose the race in either direction.
    let label = window_manager::allocate_window_label();
    registry()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data);

    // Roll back on failure so a window that never existed does not leave a
    // transfer entry behind — nothing would ever claim or destroy it.
    if let Err(e) = window_manager::create_document_window_with_label_and_url(
        &app,
        &label,
        TRANSFER_URL.to_string(),
    ) {
        clear_unclaimed_transfer(&label);
        return Err(CommandError::internal(e.to_string()));
    }

    Ok(label)
}

/// Transfer a tab directly to an existing window.
/// The target window receives a `tab:transfer` event with full payload.
#[tauri::command]
pub fn transfer_tab_to_existing_window(
    app: AppHandle,
    target_window_label: String,
    data: TabTransferData,
) -> Result<(), CommandError> {
    let Some(target_window) = app.get_webview_window(&target_window_label) else {
        return Err(CommandError::not_found(format!(
            "Target window '{target_window_label}' not found"
        )));
    };

    target_window
        .emit("tab:transfer", data)
        .map_err(|e| CommandError::internal(e.to_string()))
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
) -> Result<TabRemovalAck, CommandError> {
    validate_phase(&phase).map_err(CommandError::invalid_input)?;
    let Some(window) = app.get_webview_window(&target_window_label) else {
        return Err(CommandError::not_found(format!(
            "Target window '{target_window_label}' not found"
        )));
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
        return Err(CommandError::internal(e.to_string()));
    }

    let result = timeout(Duration::from_millis(REMOVAL_ACK_TIMEOUT_MS), rx).await;
    app.unlisten(listener);
    drop_pending_ack(&request_id);

    match result {
        Ok(Ok(ack)) => Ok(ack),
        // The destination went away mid-handshake: the world changed, the
        // caller's request was not wrong. Same class as browser::stale_command.
        Ok(Err(_)) => Err(CommandError::conflict(format!(
            "Window '{target_window_label}' dropped the tab-removal request"
        ))),
        Err(_) => Err(CommandError::timeout(format!(
            "Timed out waiting for window '{target_window_label}' to acknowledge tab removal ({phase})"
        ))),
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

#[cfg(test)]
#[path = "tab_transfer.test.rs"]
mod tests;
