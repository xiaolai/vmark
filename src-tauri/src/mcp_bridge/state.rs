//! MCP Bridge shared state and port-file management.
//!
//! Holds the global bridge state (connected clients, pending requests)
//! and utilities for the port discovery file.

use super::types::{ClientIdentity, McpResponse};
use crate::app_paths;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

/// Tracks whether the frontend webview is alive and responsive.
/// Updated by periodic heartbeat pings from the frontend.
static WEBVIEW_ALIVE: AtomicBool = AtomicBool::new(true);

/// Mark the webview as alive or not.
pub(crate) fn set_webview_alive(alive: bool) {
    WEBVIEW_ALIVE.store(alive, Ordering::Relaxed);
}

/// Check whether the webview is currently considered alive.
pub(crate) fn is_webview_alive() -> bool {
    WEBVIEW_ALIVE.load(Ordering::Relaxed)
}

/// Connected client information.
pub(crate) struct ClientConnection {
    pub tx: mpsc::UnboundedSender<String>,
    pub shutdown: Option<oneshot::Sender<()>>,
    /// Client identity (set after identify message)
    pub identity: Option<ClientIdentity>,
}

/// Bridge state shared across connections.
pub(crate) struct BridgeState {
    /// All connected clients (equal access for reads).
    pub clients: HashMap<u64, ClientConnection>,
    /// Pending requests waiting for responses from frontend.
    pub pending: HashMap<String, PendingRequest>,
    /// Counter for generating unique client IDs.
    pub next_client_id: u64,
}

/// Pending request with client ID for routing response.
pub(crate) struct PendingRequest {
    pub response_tx: oneshot::Sender<McpResponse>,
}

/// Global bridge state.
static BRIDGE_STATE: std::sync::OnceLock<Arc<Mutex<BridgeState>>> = std::sync::OnceLock::new();

/// Server shutdown signal.
static SHUTDOWN_TX: std::sync::OnceLock<Arc<RwLock<Option<oneshot::Sender<()>>>>> =
    std::sync::OnceLock::new();

/// Write lock for serializing write operations.
/// All clients can read simultaneously, but writes are serialized.
static WRITE_LOCK: std::sync::OnceLock<Arc<tokio::sync::Mutex<()>>> = std::sync::OnceLock::new();

pub(crate) fn get_bridge_state() -> Arc<Mutex<BridgeState>> {
    BRIDGE_STATE
        .get_or_init(|| {
            Arc::new(Mutex::new(BridgeState {
                clients: HashMap::new(),
                pending: HashMap::new(),
                next_client_id: 1,
            }))
        })
        .clone()
}

pub(crate) fn get_shutdown_holder() -> Arc<RwLock<Option<oneshot::Sender<()>>>> {
    SHUTDOWN_TX
        .get_or_init(|| Arc::new(RwLock::new(None)))
        .clone()
}

pub(crate) fn get_write_lock() -> Arc<tokio::sync::Mutex<()>> {
    WRITE_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Write the port to the port file for MCP sidecar discovery.
/// Uses atomic write to prevent partial reads by the sidecar.
pub(crate) fn write_port_file(app: &AppHandle, port: u16) -> Result<(), String> {
    let path = app_paths::get_port_file_path(app)?;

    // Create app data directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create app data directory {:?}: {}",
                parent, e
            )
        })?;
    }

    // Write port atomically to prevent partial reads
    app_paths::atomic_write_file(&path, port.to_string().as_bytes())?;

    log::debug!("[MCP Bridge] Port {} written to {:?}", port, path);

    Ok(())
}

/// Remove the port file when bridge stops.
/// Logs errors for non-NotFound failures (permission issues, etc.)
pub fn remove_port_file(app: &AppHandle) {
    match app_paths::get_port_file_path(app) {
        Ok(path) => {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    log::debug!("[MCP Bridge] Port file removed: {:?}", path);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Already removed - not an error
                }
                Err(e) => {
                    // Real error - log it
                    log::warn!(
                        "[MCP Bridge] Failed to remove port file {:?}: {}",
                        path, e
                    );
                }
            }
        }
        Err(e) => {
            log::warn!("[MCP Bridge] Cannot determine port file path: {}", e);
        }
    }
}

/// Check if an operation is read-only.
pub(crate) fn is_read_only_operation(request_type: &str) -> bool {
    matches!(
        request_type,
        // Document read operations
        "document.getContent"
            | "document.search"
            // Selection/cursor read operations
            | "selection.get"
            | "cursor.getContext"
            // Metadata operations
            | "outline.get"
            | "metadata.get"
            // Window/workspace read operations
            | "windows.list"
            | "windows.getFocused"
            | "workspace.getDocumentInfo"
            | "workspace.listRecentFiles"
            | "workspace.getInfo"
            // Tab read operations
            | "tabs.list"
            | "tabs.getActive"
            | "tabs.getInfo"
            // Editor state operations
            | "editor.getUndoState"
            // Suggestion read operations
            | "suggestion.list"
            // Paragraph read operations
            | "paragraph.read"
            // Protocol/structure read operations
            | "protocol.getCapabilities"
            | "protocol.getRevision"
            | "structure.getAst"
            | "structure.getDigest"
            | "structure.listBlocks"
            | "structure.resolveTargets"
            | "structure.getSection"
            // Genie read operations
            | "genies.list"
            | "genies.read"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- is_read_only_operation ------------------------------------------------

    #[test]
    fn read_only_document_operations() {
        assert!(is_read_only_operation("document.getContent"));
        assert!(is_read_only_operation("document.search"));
    }

    #[test]
    fn read_only_selection_operations() {
        assert!(is_read_only_operation("selection.get"));
        assert!(is_read_only_operation("cursor.getContext"));
    }

    #[test]
    fn read_only_metadata_operations() {
        assert!(is_read_only_operation("outline.get"));
        assert!(is_read_only_operation("metadata.get"));
    }

    #[test]
    fn read_only_window_workspace_operations() {
        assert!(is_read_only_operation("windows.list"));
        assert!(is_read_only_operation("windows.getFocused"));
        assert!(is_read_only_operation("workspace.getDocumentInfo"));
        assert!(is_read_only_operation("workspace.listRecentFiles"));
        assert!(is_read_only_operation("workspace.getInfo"));
    }

    #[test]
    fn read_only_tab_operations() {
        assert!(is_read_only_operation("tabs.list"));
        assert!(is_read_only_operation("tabs.getActive"));
        assert!(is_read_only_operation("tabs.getInfo"));
    }

    #[test]
    fn read_only_structure_operations() {
        assert!(is_read_only_operation("protocol.getCapabilities"));
        assert!(is_read_only_operation("protocol.getRevision"));
        assert!(is_read_only_operation("structure.getAst"));
        assert!(is_read_only_operation("structure.getDigest"));
        assert!(is_read_only_operation("structure.listBlocks"));
        assert!(is_read_only_operation("structure.resolveTargets"));
        assert!(is_read_only_operation("structure.getSection"));
    }

    #[test]
    fn read_only_other_operations() {
        assert!(is_read_only_operation("editor.getUndoState"));
        assert!(is_read_only_operation("suggestion.list"));
        assert!(is_read_only_operation("paragraph.read"));
    }

    #[test]
    fn read_only_genie_operations() {
        assert!(is_read_only_operation("genies.list"));
        assert!(is_read_only_operation("genies.read"));
    }

    #[test]
    fn write_operations_not_read_only() {
        assert!(!is_read_only_operation("document.insertAtCursor"));
        assert!(!is_read_only_operation("document.insertAtPosition"));
        assert!(!is_read_only_operation("document.replaceInSource"));
        assert!(!is_read_only_operation("document.setContent"));
        assert!(!is_read_only_operation("selection.replace"));
        assert!(!is_read_only_operation("editor.undo"));
        assert!(!is_read_only_operation("editor.redo"));
        assert!(!is_read_only_operation("tabs.create"));
        assert!(!is_read_only_operation("tabs.close"));
        assert!(!is_read_only_operation("tabs.switch"));
    }

    #[test]
    fn unknown_operations_not_read_only() {
        assert!(!is_read_only_operation(""));
        assert!(!is_read_only_operation("nonexistent.operation"));
        assert!(!is_read_only_operation("document.getContent ")); // trailing space
    }

    // -- webview heartbeat ----------------------------------------------------

    #[test]
    fn webview_alive_defaults_to_true() {
        // Reset to known state
        set_webview_alive(true);
        assert!(is_webview_alive());
    }

    #[test]
    fn set_webview_alive_false() {
        set_webview_alive(false);
        assert!(!is_webview_alive());
        // Restore default
        set_webview_alive(true);
    }

    #[test]
    fn set_webview_alive_round_trip() {
        set_webview_alive(false);
        assert!(!is_webview_alive());
        set_webview_alive(true);
        assert!(is_webview_alive());
    }
}
