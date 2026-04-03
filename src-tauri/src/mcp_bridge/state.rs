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

/// Maximum number of pending requests allowed at once.
pub(crate) const MAX_PENDING_REQUESTS: usize = 1000;

/// TTL in seconds for pending requests before they are considered stale.
pub(crate) const PENDING_TTL_SECS: u64 = 60;

/// Pending request with client ID for routing response.
pub(crate) struct PendingRequest {
    pub response_tx: oneshot::Sender<McpResponse>,
    pub created_at: Instant,
}

/// Remove pending requests older than `PENDING_TTL_SECS` seconds.
pub(crate) fn cleanup_stale_pending(state: &mut BridgeState) {
    let cutoff = Instant::now() - std::time::Duration::from_secs(PENDING_TTL_SECS);
    state.pending.retain(|_, req| req.created_at > cutoff);
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
/// Uses RandomState (SipHash seeded from OS entropy) for unpredictable tokens
/// without adding a `rand` or `getrandom` dependency.
pub(crate) fn generate_auth_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::fmt::Write;
    use std::hash::{BuildHasher, Hasher};

    let mut hex = String::with_capacity(64);
    // Generate 4 independent random u64s (32 bytes total)
    for _ in 0..4 {
        let state = RandomState::new();
        let mut hasher = state.build_hasher();
        hasher.write_u64(std::process::id() as u64);
        let val = hasher.finish();
        let _ = write!(hex, "{:016x}", val);
    }
    hex
}

/// Write the port and auth token to the port file for MCP sidecar discovery.
/// Format: `{port}:{token}` — sidecar must send token in auth handshake.
/// Uses atomic write to prevent partial reads by the sidecar.
pub(crate) fn write_port_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
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

    // Write port:token atomically to prevent partial reads
    let content = format!("{}:{}", port, token);
    app_paths::atomic_write_file(&path, content.as_bytes())?;

    log::debug!("[MCP Bridge] Port {} written to {:?} (with auth token)", port, path);

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

    /// Exhaustive coverage of all known write operations from the frontend MCP
    /// bridge. This ensures no write operation is accidentally classified as
    /// read-only in a future refactor.
    #[test]
    fn exhaustive_write_operations_not_read_only() {
        let write_ops = [
            // Document mutations
            "document.insert",
            "document.insertAtCursor",
            "document.insertAtPosition",
            "document.replaceInSource",
            "document.setContent",
            // Selection/cursor mutations
            "selection.delete",
            "selection.replace",
            "selection.set",
            "cursor.setPosition",
            // Editor commands
            "editor.undo",
            "editor.redo",
            "editor.focus",
            "editor.setMode",
            // Format operations
            "format.clear",
            "format.removeLink",
            "format.setLink",
            "format.toggle",
            // List operations
            "list.batchModify",
            "list.decreaseIndent",
            "list.increaseIndent",
            "list.toggle",
            // Block operations
            "block.insertHorizontalRule",
            "block.setType",
            "block.toggle",
            // Table operations
            "table.addColumnAfter",
            "table.addColumnBefore",
            "table.addRowAfter",
            "table.addRowBefore",
            "table.batchModify",
            "table.delete",
            "table.deleteColumn",
            "table.deleteRow",
            "table.insert",
            "table.toggleHeaderRow",
            // Mutation/batch operations
            "mutation.applyDiff",
            "mutation.batchEdit",
            "mutation.replaceAnchored",
            // Section operations
            "section.insert",
            "section.move",
            "section.update",
            // Paragraph write
            "paragraph.write",
            // Suggestion mutations
            "suggestion.accept",
            "suggestion.acceptAll",
            "suggestion.reject",
            "suggestion.rejectAll",
            // Tab mutations
            "tabs.create",
            "tabs.close",
            "tabs.switch",
            "tabs.reopenClosed",
            // Window mutations
            "windows.focus",
            // Workspace mutations
            "workspace.closeWindow",
            "workspace.newDocument",
            "workspace.openDocument",
            "workspace.reloadDocument",
            "workspace.saveDocument",
            "workspace.saveDocumentAs",
            // Genie invocation (side-effecting)
            "genies.invoke",
            // Smart/media insert
            "smartInsert",
            "insertMedia",
            // VMark-specific commands
            "vmark.cjkFormat",
            "vmark.cjkPunctuationConvert",
            "vmark.cjkSpacingFix",
            "vmark.insertMarkmap",
            "vmark.insertMathBlock",
            "vmark.insertMathInline",
            "vmark.insertMermaid",
            "vmark.insertSvg",
            "vmark.insertWikiLink",
        ];
        for op in &write_ops {
            assert!(
                !is_read_only_operation(op),
                "Expected '{}' to be classified as a write (non-read-only) operation",
                op
            );
        }
    }

    #[test]
    fn unknown_operations_not_read_only() {
        assert!(!is_read_only_operation(""));
        assert!(!is_read_only_operation("nonexistent.operation"));
        assert!(!is_read_only_operation("document.getContent ")); // trailing space
    }

    /// Case sensitivity: operation names are exact-match. Upper/mixed case
    /// variants must not accidentally match.
    #[test]
    fn is_read_only_is_case_sensitive() {
        assert!(!is_read_only_operation("Document.GetContent"));
        assert!(!is_read_only_operation("DOCUMENT.GETCONTENT"));
        assert!(!is_read_only_operation("document.getcontent"));
        assert!(!is_read_only_operation("SELECTION.GET"));
        assert!(!is_read_only_operation("Outline.Get"));
    }

    /// Whitespace edge cases: leading, trailing, embedded spaces must not match.
    #[test]
    fn is_read_only_rejects_whitespace_variants() {
        assert!(!is_read_only_operation(" document.getContent"));
        assert!(!is_read_only_operation("document.getContent "));
        assert!(!is_read_only_operation(" document.getContent "));
        assert!(!is_read_only_operation("document .getContent"));
        assert!(!is_read_only_operation("document. getContent"));
        assert!(!is_read_only_operation("\tdocument.getContent"));
        assert!(!is_read_only_operation("document.getContent\n"));
    }

    /// Partial/substring matches must not trigger a read-only classification.
    #[test]
    fn is_read_only_rejects_partial_matches() {
        assert!(!is_read_only_operation("document"));
        assert!(!is_read_only_operation("getContent"));
        assert!(!is_read_only_operation("document."));
        assert!(!is_read_only_operation(".getContent"));
        assert!(!is_read_only_operation("document.getContent.extra"));
        assert!(!is_read_only_operation("prefix.document.getContent"));
    }

    /// Unicode and special character strings should never match.
    #[test]
    fn is_read_only_rejects_unicode_and_special_chars() {
        assert!(!is_read_only_operation("document.getContent\u{200B}")); // zero-width space
        assert!(!is_read_only_operation("döcument.getContent"));
        assert!(!is_read_only_operation("文档.获取内容"));
        assert!(!is_read_only_operation("document\0getContent")); // null byte
    }

    /// Very long strings should not cause issues.
    #[test]
    fn is_read_only_handles_long_strings() {
        let long_op = "a".repeat(10_000);
        assert!(!is_read_only_operation(&long_op));
    }

    // -- webview heartbeat ----------------------------------------------------
    //
    // WEBVIEW_ALIVE is a global AtomicBool shared across all parallel tests.
    // Multi-step set→assert sequences are inherently racy when other tests
    // also call set_webview_alive. To avoid flakiness, all webview alive
    // tests are consolidated into one #[test] that runs sequentially.

    #[test]
    fn webview_alive_behavior() {
        // --- basic set/get ---
        set_webview_alive(true);
        assert!(is_webview_alive(), "should be true after set(true)");

        set_webview_alive(false);
        assert!(!is_webview_alive(), "should be false after set(false)");

        // --- round-trip ---
        set_webview_alive(false);
        assert!(!is_webview_alive());
        set_webview_alive(true);
        assert!(is_webview_alive());

        // --- idempotent repeated sets ---
        for _ in 0..3 {
            set_webview_alive(true);
        }
        assert!(is_webview_alive());

        for _ in 0..3 {
            set_webview_alive(false);
        }
        assert!(!is_webview_alive());

        // --- rapid toggling converges to last value ---
        for _ in 0..1000 {
            set_webview_alive(false);
            set_webview_alive(true);
        }
        assert!(is_webview_alive());

        for _ in 0..1000 {
            set_webview_alive(true);
            set_webview_alive(false);
        }
        assert!(!is_webview_alive());

        // Restore
        set_webview_alive(true);
    }

    /// Multiple threads toggling the flag concurrently.
    /// We cannot predict the final value, but the test verifies no panic,
    /// no UB, and the flag is readable afterwards.
    #[test]
    fn webview_alive_concurrent_access() {
        use std::sync::Arc;
        use std::sync::Barrier;

        let barrier = Arc::new(Barrier::new(4));
        let mut handles = Vec::new();

        for i in 0..4 {
            let b = barrier.clone();
            handles.push(std::thread::spawn(move || {
                b.wait();
                for _ in 0..500 {
                    set_webview_alive(i % 2 == 0);
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        // The value is non-deterministic after concurrent access;
        // just confirm the call doesn't panic.
        let _ = is_webview_alive();

        // Restore
        set_webview_alive(true);
    }

    // -- bridge state initialization ------------------------------------------

    /// Bridge state is initialized and accessible. Because OnceLock is
    /// shared across tests (which run in parallel), we only assert
    /// structural invariants rather than exact initial values.
    #[tokio::test]
    async fn bridge_state_is_accessible() {
        let state = get_bridge_state();
        let guard = state.lock().await;
        // The maps may have been touched by parallel tests, but the lock
        // itself must be acquirable without panic.
        let _ = guard.clients.len();
        let _ = guard.pending.len();
        assert!(guard.next_client_id >= 1);
    }

    /// Calling get_bridge_state() multiple times returns the same Arc.
    #[tokio::test]
    async fn bridge_state_is_singleton() {
        let s1 = get_bridge_state();
        let s2 = get_bridge_state();
        assert!(Arc::ptr_eq(&s1, &s2));
    }

    /// Mutations through one Arc reference are visible through another.
    /// Uses the `pending` map (keyed by a unique test marker) to avoid
    /// interference with other tests that mutate `next_client_id`.
    #[tokio::test]
    async fn bridge_state_shared_mutation() {
        let s1 = get_bridge_state();
        let s2 = get_bridge_state();

        let marker = "__test_shared_mutation__".to_string();

        {
            let mut guard = s1.lock().await;
            let (tx, _rx) = oneshot::channel::<McpResponse>();
            guard
                .pending
                .insert(marker.clone(), PendingRequest { response_tx: tx, created_at: Instant::now() });
        }

        {
            let guard = s2.lock().await;
            assert!(guard.pending.contains_key(&marker));
        }

        // Clean up
        {
            let mut guard = s1.lock().await;
            guard.pending.remove(&marker);
        }
    }

    /// Multiple tasks concurrently insert into the `pending` map. The Mutex
    /// guarantees all insertions succeed without data loss.
    #[tokio::test]
    async fn bridge_state_concurrent_pending_insert() {
        let state = get_bridge_state();
        let mut handles = Vec::new();

        for i in 0..10 {
            let s = state.clone();
            handles.push(tokio::spawn(async move {
                let mut guard = s.lock().await;
                let (tx, _rx) = oneshot::channel::<McpResponse>();
                guard
                    .pending
                    .insert(format!("__concurrent_test_{i}__"), PendingRequest { response_tx: tx, created_at: Instant::now() });
            }));
        }

        for h in handles {
            h.await.unwrap();
        }

        {
            let mut guard = state.lock().await;
            for i in 0..10 {
                let key = format!("__concurrent_test_{i}__");
                assert!(guard.pending.contains_key(&key), "missing key: {key}");
                guard.pending.remove(&key);
            }
        }
    }

    // -- shutdown holder ------------------------------------------------------

    #[tokio::test]
    async fn shutdown_holder_is_singleton() {
        let h1 = get_shutdown_holder();
        let h2 = get_shutdown_holder();
        assert!(Arc::ptr_eq(&h1, &h2));
    }

    /// Store a sender, take it back, fire it, and verify the receiver
    /// gets the signal. Covers the full lifecycle of the shutdown holder.
    #[tokio::test]
    async fn shutdown_holder_store_take_fire() {
        let holder = get_shutdown_holder();

        let (tx, rx) = oneshot::channel::<()>();
        {
            let mut guard = holder.write().await;
            *guard = Some(tx);
        }

        // Take and fire
        {
            let mut guard = holder.write().await;
            let tx = guard.take();
            assert!(tx.is_some());
            assert!(guard.is_none()); // gone after take
            tx.unwrap().send(()).unwrap();
        }

        // Receiver got the signal
        assert!(rx.await.is_ok());
    }

    // -- write lock -----------------------------------------------------------

    #[tokio::test]
    async fn write_lock_is_singleton() {
        let l1 = get_write_lock();
        let l2 = get_write_lock();
        assert!(Arc::ptr_eq(&l1, &l2));
    }

    /// Verify the write lock serializes concurrent access.
    #[tokio::test]
    async fn write_lock_serializes_access() {
        let lock = get_write_lock();
        let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let mut handles = Vec::new();

        for _ in 0..5 {
            let l = lock.clone();
            let c = counter.clone();
            handles.push(tokio::spawn(async move {
                let _guard = l.lock().await;
                // Read, yield, write pattern — would race without the lock
                let val = c.load(Ordering::SeqCst);
                tokio::task::yield_now().await;
                c.store(val + 1, Ordering::SeqCst);
            }));
        }

        for h in handles {
            h.await.unwrap();
        }

        assert_eq!(counter.load(Ordering::SeqCst), 5);
    }

    // -- auth token generation ---------------------------------------------------

    #[test]
    fn auth_token_is_64_hex_chars() {
        let token = generate_auth_token();
        assert_eq!(token.len(), 64, "Token should be 64 hex chars (32 bytes)");
        assert!(
            token.chars().all(|c| c.is_ascii_hexdigit()),
            "Token should contain only hex chars: {}",
            token
        );
    }

    #[test]
    fn auth_token_is_unique_per_call() {
        let t1 = generate_auth_token();
        let t2 = generate_auth_token();
        assert_ne!(t1, t2, "Two tokens should not be identical");
    }

    #[test]
    fn auth_token_has_sufficient_entropy() {
        // Generate 100 tokens and verify no duplicates
        let tokens: std::collections::HashSet<String> =
            (0..100).map(|_| generate_auth_token()).collect();
        assert_eq!(tokens.len(), 100, "100 tokens should all be unique");
    }

    // -- pending request TTL --------------------------------------------------

    #[tokio::test]
    async fn pending_request_has_created_at() {
        let (tx, _rx) = oneshot::channel::<McpResponse>();
        let req = PendingRequest {
            response_tx: tx,
            created_at: std::time::Instant::now(),
        };
        assert!(req.created_at.elapsed().as_secs() < 1);
    }

    #[tokio::test]
    async fn cleanup_stale_pending_removes_old_entries() {
        use std::time::Duration;

        let state = get_bridge_state();

        let marker_stale = "__test_stale_cleanup__".to_string();
        let marker_fresh = "__test_fresh_cleanup__".to_string();

        {
            let mut guard = state.lock().await;
            let (tx1, _rx1) = oneshot::channel::<McpResponse>();
            guard.pending.insert(marker_stale.clone(), PendingRequest {
                response_tx: tx1,
                created_at: std::time::Instant::now() - Duration::from_secs(120),
            });
            let (tx2, _rx2) = oneshot::channel::<McpResponse>();
            guard.pending.insert(marker_fresh.clone(), PendingRequest {
                response_tx: tx2,
                created_at: std::time::Instant::now(),
            });
        }

        {
            let mut guard = state.lock().await;
            cleanup_stale_pending(&mut guard);
            assert!(!guard.pending.contains_key(&marker_stale));
            assert!(guard.pending.contains_key(&marker_fresh));
            guard.pending.remove(&marker_fresh);
        }
    }
}
