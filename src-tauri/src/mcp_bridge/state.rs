//! MCP Bridge shared state and port-file management.
//!
//! Holds the global bridge state (connected clients, pending requests)
//! and utilities for the port discovery file.

use super::types::{ClientIdentity, McpResponse};
use crate::app_paths;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
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

/// Per-client outbound message queue capacity.
///
/// Sized to absorb realistic bursts (streaming AI chunks, batched search
/// results, workflow progress) while bounding memory if a client stalls.
/// A slow/dead client overflows long before the process runs out of memory;
/// senders drop the message and log rather than blocking the server.
pub(crate) const CLIENT_TX_CAPACITY: usize = 1024;
// Compile-time sanity bound: a sane positive capacity, not the `usize::MAX`
// sentinel an unbounded channel would imply.
const _: () = assert!(CLIENT_TX_CAPACITY > 0 && CLIENT_TX_CAPACITY <= 65_536);

/// Connected client information.
pub(crate) struct ClientConnection {
    pub tx: mpsc::Sender<String>,
    pub shutdown: Option<oneshot::Sender<()>>,
    /// Client identity (set after identify message)
    pub identity: Option<ClientIdentity>,
}

/// Bridge state shared across connections.
pub(crate) struct BridgeState {
    /// All connected clients (equal access for reads).
    pub clients: HashMap<u64, ClientConnection>,
    /// Pending requests waiting for responses from frontend, keyed by a
    /// bridge-internal request id (never the client-supplied message id, so
    /// two clients reusing the same message id cannot collide).
    pub pending: HashMap<String, PendingRequest>,
    /// Counter for generating unique client IDs.
    pub next_client_id: u64,
}

/// Maximum number of pending requests allowed at once.
pub(crate) const MAX_PENDING_REQUESTS: usize = 1000;

/// TTL in seconds for pending requests before they are considered stale.
pub(crate) const PENDING_TTL_SECS: u64 = 60;

/// A request awaiting its response from the frontend. Keyed in
/// `BridgeState::pending` by a bridge-internal request id; the response is
/// routed back to the requesting client through `response_tx`.
pub(crate) struct PendingRequest {
    pub response_tx: oneshot::Sender<McpResponse>,
    pub created_at: Instant,
}

/// Remove pending requests older than `PENDING_TTL_SECS` seconds.
///
/// `Instant`'s epoch is boot time on the major platforms, so subtracting the
/// TTL from `now` underflows (and panics) when system uptime is shorter than
/// the TTL — e.g. VMark launched as a login item right after boot. Use
/// `checked_sub` and treat an unrepresentable cutoff as "nothing is stale".
pub(crate) fn cleanup_stale_pending(state: &mut BridgeState) {
    let cutoff = Instant::now().checked_sub(std::time::Duration::from_secs(PENDING_TTL_SECS));
    state
        .pending
        .retain(|_, req| cutoff.is_none_or(|c| req.created_at > c));
}

/// Register a pending request, enforcing the stale-entry TTL sweep and the
/// `MAX_PENDING_REQUESTS` overload cap.
///
/// Returns the client-facing error message when the queue is full so the
/// caller can answer the client instead of silently dropping the request
/// (which would leave it hanging until its own timeout).
pub(crate) fn try_register_pending(
    state: &mut BridgeState,
    request_id: String,
    response_tx: oneshot::Sender<McpResponse>,
) -> Result<(), String> {
    cleanup_stale_pending(state);
    if state.pending.len() >= MAX_PENDING_REQUESTS {
        return Err(format!(
            "MCP bridge pending request queue full ({} in flight)",
            MAX_PENDING_REQUESTS
        ));
    }
    state.pending.insert(
        request_id,
        PendingRequest {
            response_tx,
            created_at: Instant::now(),
        },
    );
    Ok(())
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

/// Generate a random hex auth token for MCP bridge authentication.
/// 32 bytes of CSPRNG entropy via two v4 UUIDs (uuid -> getrandom) —
/// SipHash/RandomState is not a cryptographic RNG and an auth token is a
/// cryptographic secret (audit 20260612).
pub(crate) fn generate_auth_token() -> String {
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    format!("{}{}", a.simple(), b.simple())
}

/// Write the port and auth token to the port file for MCP sidecar discovery.
/// Format: `{port}:{token}` — sidecar must send token in auth handshake.
/// Uses atomic write to prevent partial reads by the sidecar.
pub(crate) fn write_port_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let path = app_paths::get_port_file_path(app)?;

    // Create app data directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app data directory {:?}: {}", parent, e))?;
    }

    // Write port:token atomically to prevent partial reads
    let content = format!("{}:{}", port, token);
    app_paths::atomic_write_file(&path, content.as_bytes())?;

    log::debug!(
        "[MCP Bridge] Port {} written to {:?} (with auth token)",
        port,
        path
    );

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
                    log::warn!("[MCP Bridge] Failed to remove port file {:?}: {}", path, e);
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
            // Pruned 5-tool surface (vmark.* prefix) — read operations.
            // Wire types defined in vmark-mcp-server/src/bridge/core-types.ts.
            // Missing entries here forced every concurrent AI client read
            // (Claude Code + Codex + Cursor) to serialize through WRITE_LOCK.
            | "vmark.session.get_state"
            | "vmark.document.read"
            | "vmark.selection.get"
            | "vmark.workflow.validate"
            // Embedded-browser read-class ops (Codex audit 20260718). Wire
            // types in vmark-mcp-server/src/tools/browser.ts. These mutate
            // nothing; the bounded waits especially must not hold the global
            // write lock for up to their full 12s timeout. Write-class
            // browser ops (act, open, navigate, style, execute_js,
            // session.save/load, console with its buffer drain) stay
            // serialized through WRITE_LOCK.
            | "vmark.browser.read"
            | "vmark.browser.wait"
            | "vmark.browser.wait_for"
            | "vmark.browser.query"
            | "vmark.browser.screenshot"
            // Coherence status (WI-1.10) is a pure projection. `edges` is
            // deliberately NOT here: it runs scan reconciliation, which
            // appends provenance records — server.rs takes the write lock
            // for it (audit C4/C5).
            | "vmark.coherence.status"
    )
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
