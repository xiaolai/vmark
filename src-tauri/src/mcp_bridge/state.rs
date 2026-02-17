//! MCP Bridge shared state and port-file management.
//!
//! Holds the global bridge state (connected clients, pending requests)
//! and utilities for the port discovery file.

use super::types::{ClientIdentity, McpResponse};
use crate::app_paths;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

/// Connected client information.
pub(crate) struct ClientConnection {
    #[allow(dead_code)]
    pub id: u64,
    #[allow(dead_code)]
    pub addr: SocketAddr,
    pub tx: mpsc::UnboundedSender<String>,
    pub shutdown: Option<oneshot::Sender<()>>,
    #[allow(dead_code)]
    pub connected_at: Instant,
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
    #[allow(dead_code)]
    pub client_id: u64,
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

    #[cfg(debug_assertions)]
    eprintln!("[MCP Bridge] Port {} written to {:?}", port, path);

    Ok(())
}

/// Remove the port file when bridge stops.
/// Logs errors for non-NotFound failures (permission issues, etc.)
pub(crate) fn remove_port_file(app: &AppHandle) {
    match app_paths::get_port_file_path(app) {
        Ok(path) => {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Bridge] Port file removed: {:?}", path);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Already removed - not an error
                }
                Err(e) => {
                    // Real error - log it
                    eprintln!(
                        "[MCP Bridge] Warning: Failed to remove port file {:?}: {}",
                        path, e
                    );
                }
            }
        }
        Err(e) => {
            eprintln!("[MCP Bridge] Warning: Cannot determine port file path: {}", e);
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
    )
}
