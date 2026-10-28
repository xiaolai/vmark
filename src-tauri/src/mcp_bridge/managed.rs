//! The MCP bridge's Tauri-managed state.
//!
//! Everything the bridge mutates at runtime lives on one struct that `lib.rs`
//! hands to `.manage()`: the connection/pending tables, the server's shutdown
//! signal, the write lock that serializes write-class operations, the coarse
//! webview-liveness flag, and the connection-admission generation.
//!
//! It used to be five process-global `OnceLock`/atomic statics in `state.rs`.
//! Statics made every test in the binary share one bridge, which is why the
//! suite carried a global test mutex, `__test_…__` marker keys, and a comment
//! explaining that assertions could only be "structural" because parallel
//! tests mutated the same maps. A managed state is reached from the
//! `AppHandle` that every bridge path already has, so a test gets its own
//! bridge by building its own mock app — and the cope is deletable.
//!
//! `McpBridgeState` is what Tauri manages; [`BridgeState`] is what its mutex
//! guards.
//!
//! @coordinates-with mcp_bridge/state.rs — the guarded tables and their helpers
//! @coordinates-with lib.rs — `.manage(McpBridgeState::default())`
//! @module mcp_bridge::managed

use super::lifecycle::BridgeLifecycle;
use super::principal::BridgePrincipal;
use super::state::{BridgeState, ClientConnection};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{oneshot, Mutex, MutexGuard, RwLock, RwLockReadGuard};

/// Shared bridge state, held by the Tauri app for the life of the process.
pub struct McpBridgeState {
    /// Connected clients, pending requests, and the window→workspace map.
    tables: Mutex<BridgeState>,
    /// Server shutdown signal. Every access is exclusive (install / take), so
    /// a plain `Mutex` is the honest primitive — the `RwLock` this replaced
    /// had no read-lock path.
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    /// Serializes write-class operations. All clients may read at once; writes
    /// go one at a time.
    write_lock: Mutex<()>,
    /// Coarse webview liveness, DIAGNOSTIC ONLY: set false when a bridge
    /// request times out, set true by the frontend heartbeat command. It feeds
    /// the wake-retry log line in `server.rs` and gates no authorization or
    /// routing decision. It deliberately does not expire on its own and does
    /// not distinguish windows — a per-window freshness model would be
    /// required before using it for anything load-bearing.
    webview_alive: AtomicBool,
    /// Connection-admission generation. `stop_bridge` bumps it (while holding
    /// the tables lock) before draining clients, and a connection task
    /// re-checks it at registration time — an in-flight handshake that
    /// authenticates after the drain must not register into a stopped (or
    /// restarted) bridge and survive shutdown.
    ///
    /// This one is NOT test-isolation machinery and does not go away with the
    /// statics: the bridge can be stopped and started again within one process
    /// (`mcp_bridge_start`/`mcp_bridge_stop`), and the managed state outlives
    /// both. A boolean "accepting" flag would not do — it cannot tell a stray
    /// from the OLD bridge apart from a legitimate peer of the new one.
    connection_generation: AtomicU64,
    /// The server's start/stop lifecycle — running flag, bound port and the
    /// start generation — which used to be three statics in `control.rs`
    /// (audit 20260907 #177).
    lifecycle: BridgeLifecycle,
    /// Rust-answered operations in flight: each holds a read lease from
    /// admission to completion (`admit_operation`), and `stop_bridge` takes
    /// the write side after draining, so it completes only after every
    /// operation admitted before the drain — and none admitted after it.
    operations: RwLock<()>,
}

impl Default for McpBridgeState {
    /// A bridge with nothing connected and no shutdown signal installed. The
    /// webview starts ALIVE: it is a suspicion flag, and suspecting a webview
    /// nobody has talked to yet would log a wake-retry on the first request.
    fn default() -> Self {
        Self {
            tables: Mutex::new(BridgeState::default()),
            shutdown_tx: Mutex::new(None),
            write_lock: Mutex::new(()),
            webview_alive: AtomicBool::new(true),
            connection_generation: AtomicU64::new(0),
            lifecycle: BridgeLifecycle::default(),
            operations: RwLock::new(()),
        }
    }
}

impl McpBridgeState {
    /// The server's start/stop lifecycle.
    pub(crate) fn lifecycle(&self) -> &BridgeLifecycle {
        &self.lifecycle
    }

    /// Lock the connection/pending tables.
    pub(crate) async fn lock(&self) -> MutexGuard<'_, BridgeState> {
        self.tables.lock().await
    }

    /// Lock the slot holding the server's shutdown sender.
    pub(crate) async fn shutdown_slot(&self) -> MutexGuard<'_, Option<oneshot::Sender<()>>> {
        self.shutdown_tx.lock().await
    }

    /// Acquire the write lock that serializes write-class operations.
    pub(crate) async fn write_lock(&self) -> MutexGuard<'_, ()> {
        self.write_lock.lock().await
    }

    /// The write lock for a client's request, or the WRITE_BUSY refusal once
    /// [`WRITE_LOCK_WAIT`](super::state::WRITE_LOCK_WAIT) passes without it.
    /// The refusal comes before the request is registered or run, so it is a
    /// definite "not applied" the client can retry.
    pub(crate) async fn write_lock_for_request(&self) -> Result<MutexGuard<'_, ()>, String> {
        tokio::time::timeout(super::state::WRITE_LOCK_WAIT, self.write_lock.lock())
            .await
            .map_err(|_| {
                format!(
                    "WRITE_BUSY: another write held VMark's write lock for {} s; this request was not applied. Retry it.",
                    super::state::WRITE_LOCK_WAIT.as_secs()
                )
            })
    }

    /// Mark the webview as alive or not.
    pub(crate) fn set_webview_alive(&self, alive: bool) {
        self.webview_alive.store(alive, Ordering::Relaxed);
    }

    /// Whether the webview is currently considered alive.
    pub(crate) fn is_webview_alive(&self) -> bool {
        self.webview_alive.load(Ordering::Relaxed)
    }

    /// Current admission generation (captured by the accept loop per
    /// connection).
    pub(crate) fn connection_generation(&self) -> u64 {
        self.connection_generation.load(Ordering::SeqCst)
    }

    /// Invalidate every connection admitted before this call (see the field).
    pub(crate) fn bump_connection_generation(&self) {
        self.connection_generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Register an authenticated client, unless the bridge generation moved on
    /// while the peer was mid-handshake. `stop_bridge` bumps the generation
    /// UNDER the tables lock before draining, so either this registration
    /// lands first (and is drained) or the stale generation is visible here
    /// and refused.
    pub(crate) async fn try_register_client(
        &self,
        client_id: u64,
        connection: ClientConnection,
        admitted_generation: u64,
    ) -> bool {
        let mut guard = self.lock().await;
        if self.connection_generation() != admitted_generation {
            return false;
        }
        guard.clients.insert(client_id, connection);
        true
    }

    /// The principal a connected client authenticated as.
    ///
    /// This is the ONLY input to an authorization decision on the bridge, and
    /// it is read from the connection record written at auth time — never from
    /// anything the client sends afterwards. Its predecessor
    /// (`asserted_principal`) returned `identity.name` from the client's own
    /// `identify` message, so any token-holder could claim another client's
    /// grants and have the ratification receipt record that client as the
    /// actor. See `principal.rs` for the mechanism and
    /// its honest boundary.
    ///
    /// A client id with no live connection resolves to
    /// [`BridgePrincipal::Anonymous`]: it authorizes nothing, which is the
    /// correct answer for a peer that is not there.
    pub(crate) async fn connection_principal(&self, client_id: u64) -> BridgePrincipal {
        self.lock()
            .await
            .clients
            .get(&client_id)
            .map(|c| c.principal.clone())
            .unwrap_or(BridgePrincipal::Anonymous)
    }
}

impl McpBridgeState {
    /// Admit one Rust-answered operation for `client_id`: a lease held until
    /// the operation finishes, or `None` when the client is gone (a stop
    /// drained it). The lease is taken BEFORE the liveness check, so a stop
    /// that drains after the check waits for the operation
    /// ([`Self::await_operations`]), and one that drained before it refuses.
    pub(crate) async fn admit_operation(&self, client_id: u64) -> Option<RwLockReadGuard<'_, ()>> {
        let lease = self.operations.read().await;
        self.lock()
            .await
            .clients
            .contains_key(&client_id)
            .then_some(lease)
    }

    /// Wait until every admitted operation has finished. `stop_bridge` calls
    /// it after draining the clients, so no new operation can be admitted,
    /// and bounds the wait.
    pub(crate) async fn await_operations(&self) {
        drop(self.operations.write().await);
    }

    /// Forget everything keyed by a destroyed window's label. Its webview
    /// dies without clearing its own workspace and tab registrations.
    pub(crate) async fn forget_window(&self, label: &str) {
        let mut guard = self.lock().await;
        guard.window_workspaces.remove(label);
        guard.window_tabs.remove(label);
    }

    /// Replace the tabs `label`'s window holds; an empty list removes its entry.
    pub(crate) async fn set_window_tabs(&self, label: &str, tab_ids: Vec<String>) {
        let mut guard = self.lock().await;
        if tab_ids.is_empty() {
            guard.window_tabs.remove(label);
        } else {
            guard.window_tabs.insert(label.to_string(), tab_ids);
        }
    }
}

/// Reach the bridge state an app manages.
///
/// Panics if it was never managed. That is a composition-root bug, not a
/// runtime condition: `lib.rs` manages it before any command, bridge task or
/// window exists, and a test that drives bridge code builds a mock app that
/// does the same.
pub(crate) fn bridge<R: Runtime>(app: &AppHandle<R>) -> &McpBridgeState {
    app.state::<McpBridgeState>().inner()
}

#[cfg(test)]
#[path = "managed.test.rs"]
mod tests;

// Mock-runtime tests: `tauri::test` does not exist on Windows.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "operation_lease.test.rs"]
mod operation_lease_tests;
