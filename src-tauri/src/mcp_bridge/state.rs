//! MCP Bridge shared state.
//!
//! Holds the process-global bridge state — connected clients, pending
//! requests, the window→workspace map, the shutdown signal and the write
//! lock — plus the small helpers that operate on it (pending-request
//! registration and TTL sweep, auth-token generation, the read-only
//! operation list).
//!
//! The port discovery file and its permission contract live in
//! `token_file.rs`; this module has not owned them since WI-9.

use super::principal::BridgePrincipal;
use super::types::{ClientIdentity, McpResponse};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot, Mutex};

/// Coarse process-global webview liveness flag, DIAGNOSTIC ONLY: set false
/// when a bridge request times out, set true by the frontend heartbeat
/// command. It feeds the wake-retry log line in `server.rs` and gates no
/// authorization or routing decision. It deliberately does not expire on its
/// own and does not distinguish windows — a per-window freshness model would
/// be required before using it for anything load-bearing.
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
    /// What the client SAYS it is, from its `identify` message.
    ///
    /// Display only — the Integrations panel's connected-clients list and the
    /// connect/disconnect log lines. It reaches no authorization decision and
    /// must not start to: it is caller-supplied and re-sendable, which is
    /// exactly the defect fixed by binding `principal` to a credential instead
    /// (audit 20260728 §2.1). See `principal.rs`.
    pub identity: Option<ClientIdentity>,
    /// Who the client PROVED it is, fixed at authentication time from the
    /// per-client credential it presented. Immutable for the life of the
    /// connection — nothing the client sends afterwards can change it.
    pub principal: BridgePrincipal,
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
    /// F5 (WI-3.5): window label → canonical open-workspace root. The
    /// frontend registers this on workspace open/close so the router can
    /// send workspace-scoped requests to the owning window, not just the
    /// focused one.
    pub window_workspaces: HashMap<String, String>,
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
    // Bridge-internal ids are generated from a monotonic counter, so a
    // duplicate indicates a bug — reject it loudly instead of silently
    // replacing (and thereby stranding) the original request's channel.
    match state.pending.entry(request_id) {
        std::collections::hash_map::Entry::Occupied(entry) => Err(format!(
            "MCP bridge internal error: duplicate pending request id {}",
            entry.key()
        )),
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(PendingRequest {
                response_tx,
                created_at: Instant::now(),
            });
            Ok(())
        }
    }
}

/// Global bridge state.
static BRIDGE_STATE: std::sync::OnceLock<Arc<Mutex<BridgeState>>> = std::sync::OnceLock::new();

/// Server shutdown signal. Every access is exclusive (install / take), so a
/// plain `Mutex` is the honest primitive — the previous `RwLock` had no
/// read-lock path.
static SHUTDOWN_TX: std::sync::OnceLock<Arc<Mutex<Option<oneshot::Sender<()>>>>> =
    std::sync::OnceLock::new();

/// Write lock for serializing write operations.
/// All clients can read simultaneously, but writes are serialized.
static WRITE_LOCK: std::sync::OnceLock<Arc<tokio::sync::Mutex<()>>> = std::sync::OnceLock::new();

/// The principal a connected client authenticated as.
///
/// This is the ONLY input to an authorization decision on the bridge, and it
/// is read from the connection record written at auth time — never from
/// anything the client sends afterwards. Its predecessor
/// (`asserted_principal`) returned `identity.name` from the client's own
/// `identify` message, so any token-holder could claim another client's grants
/// and have the ratification receipt record that client as the actor
/// (audit 20260728 §2.1). See `principal.rs` for the mechanism and its honest
/// boundary.
///
/// A client id with no live connection resolves to
/// [`BridgePrincipal::Anonymous`]: it authorizes nothing, which is the correct
/// answer for a peer that is not there.
pub(crate) async fn connection_principal(client_id: u64) -> BridgePrincipal {
    let state = get_bridge_state();
    let guard = state.lock().await;
    guard
        .clients
        .get(&client_id)
        .map(|c| c.principal.clone())
        .unwrap_or(BridgePrincipal::Anonymous)
}

pub(crate) fn get_bridge_state() -> Arc<Mutex<BridgeState>> {
    BRIDGE_STATE
        .get_or_init(|| {
            Arc::new(Mutex::new(BridgeState {
                clients: HashMap::new(),
                pending: HashMap::new(),
                next_client_id: 1,
                window_workspaces: HashMap::new(),
            }))
        })
        .clone()
}

pub(crate) fn get_shutdown_holder() -> Arc<Mutex<Option<oneshot::Sender<()>>>> {
    SHUTDOWN_TX
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
}

pub(crate) fn get_write_lock() -> Arc<tokio::sync::Mutex<()>> {
    WRITE_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Generate the ephemeral shared bridge token written to the port file.
///
/// 32 bytes of CSPRNG entropy — see `crate::secret_token`, which is also where
/// the per-client credentials in `mcp_config::client_tokens` come from, so the
/// two cannot drift on the property that matters.
pub(crate) fn generate_auth_token() -> String {
    crate::secret_token::generate_secret_token()
}

/// Check if an operation is read-only.
///
/// ONLY current `vmark.*` operations are classified (the pruned 5-tool
/// surface; wire types in server/mcp/src/bridge/core-types.ts). Everything
/// else — including the pre-pruning legacy names (`document.getContent`,
/// `tabs.list`, …) — falls through to write-class (fail closed): the
/// frontend dispatcher only accepts `vmark.*` and rejects the rest as
/// unknown, and the Rust-answered ops (`windows.list`, `windows.getFocused`)
/// are answered in routing BEFORE this classifier runs, so legacy entries
/// here were unreachable dead weight (audit 20260729 C4).
pub(crate) fn is_read_only_operation(request_type: &str) -> bool {
    matches!(
        request_type,
        // Missing entries here forced every concurrent AI client read
        // (Claude Code + Codex + Cursor) to serialize through WRITE_LOCK.
        "vmark.session.get_state"
            | "vmark.document.read"
            | "vmark.selection.get"
            | "vmark.workflow.validate"
            // Embedded-browser read-class ops (Codex audit 20260718). Wire
            // types in server/mcp/src/tools/browser.ts. These mutate
            // nothing; the bounded waits especially must not hold the global
            // write lock for up to their full 12s timeout. Write-class
            // browser ops (act, open, navigate, style, execute_js,
            // session.save/load, console with its buffer drain) stay
            // serialized through WRITE_LOCK.
            //
            // `vmark.browser.wait` is deliberately NOT here (audit 20260729):
            // unlike its read-class siblings, its frontend handler activates
            // the target window and creates/attaches the native browser view
            // (`activateBrowserTarget` + `ensureBrowserNativeView` in
            // src/hooks/mcpBridge/v2/browserNavigation.ts) — real mutations
            // that must serialize through WRITE_LOCK.
            | "vmark.browser.read"
            | "vmark.browser.wait_for"
            | "vmark.browser.query"
            | "vmark.browser.screenshot" // Coherence ops are deliberately ABSENT: they are Rust-answered in
                                         // `answer_rust_side` BEFORE this classifier runs, and
                                         // `routing::answer_coherence_async` applies its own lock policy
                                         // (edges/resolve take the write lock; status/claims/contexts do not).
                                         // An entry here would be unreachable dead weight (WI-1 manifest
                                         // parity: src/hooks/mcpBridge/v2/operationManifest.ts).
    )
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;

/// Generation of the bridge for CONNECTION ADMISSION. `stop_bridge` bumps it
/// (while holding the bridge state lock) before draining clients, and a
/// connection task re-checks it at registration time — an in-flight handshake
/// that authenticates after the drain must not register into a stopped (or
/// restarted) bridge and survive shutdown.
static CONNECTION_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Current admission generation (captured by the accept loop per connection).
pub(super) fn connection_generation() -> u64 {
    CONNECTION_GENERATION.load(Ordering::SeqCst)
}

/// Invalidate every connection admitted before this call (see above).
pub(super) fn bump_connection_generation() {
    CONNECTION_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Register an authenticated client, unless the bridge generation moved on
/// while the peer was mid-handshake. `stop_bridge` bumps the generation UNDER
/// the state lock before draining, so either this registration lands first
/// (and is drained) or the stale generation is visible here and refused.
pub(super) async fn try_register_client(
    client_id: u64,
    connection: ClientConnection,
    admitted_generation: u64,
) -> bool {
    let state = get_bridge_state();
    let mut guard = state.lock().await;
    if connection_generation() != admitted_generation {
        return false;
    }
    guard.clients.insert(client_id, connection);
    true
}
