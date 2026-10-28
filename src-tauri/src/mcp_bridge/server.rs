//! MCP Bridge WebSocket server: stopping it, and deciding what an envelope is.
//!
//! Bringing it UP is `start.rs` — bind, publish, refresh, spawn — which
//! moved out so its four steps could be driven on a mock app with the port
//! file and the client-token refresh injected. What is left here is the
//! teardown (`stop_bridge`, pinned in `server.test.rs`) and the ENVELOPE
//! dispatch: identify, unsupported type, a request Rust answers itself, or a
//! request that has to reach a window.
//!
//! That last one is `routed_request.rs`. `handle_message` was 232
//! lines and this file was 398 — over the ~300-line limit and holding two
//! unrelated jobs, so the routed request's ordering (register, route, emit,
//! wait, deliver) was buried inside the parse that precedes it.
//!
//! @coordinates-with mcp_bridge/connection_closed.rs — announces each drained connection
//! @coordinates-with mcp_bridge/identify.rs — the `identify` envelope
//! @coordinates-with mcp_bridge/routed_request.rs — the request that reaches a window
//! @coordinates-with peer_text.rs — how client text may be logged
//! @module mcp_bridge::server

use super::connection_closed::announce_connection_closed;
use super::delivery::{deliver_response, send_error_response};
use super::identify::handle_identify;
use super::managed::{bridge, McpBridgeState};
use super::routing::answer_rust_side;
use super::token_file::remove_port_file;
use super::types::{McpRequest, McpResponse, WsMessage};
use crate::peer_text::peer_text;
use tauri::AppHandle;
use tokio::sync::mpsc;

/// Stop the MCP bridge WebSocket server.
///
/// Generic over the runtime so the teardown — the loop signalled, the
/// writes already emitted answered by their windows, every client's shutdown
/// fired, every pending request answered, the admission
/// generation bumped, every admitted Rust-side operation finished (bounded) — is
/// pinned on a mock app (`server.test.rs`, `operation_lease.test.rs`).
pub async fn stop_bridge<R: tauri::Runtime>(app: &AppHandle<R>) {
    stop_bridge_with(app, InFlightWrites::Await).await;
}

/// What a stop does with writes already emitted to a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InFlightWrites {
    /// Wait (bounded) for their windows' answers — every stop but the exit.
    Await,
    /// Answer them at once, their outcome stated unknown. Only the app exit: it stops on
    /// the main thread, which the window's answer has to cross, so waiting
    /// there would always run to the bound — and the process is ending.
    Abandon,
}

/// [`stop_bridge`], choosing what happens to writes already emitted.
pub async fn stop_bridge_with<R: tauri::Runtime>(app: &AppHandle<R>, writes: InFlightWrites) {
    // Remove port file so MCP sidecar knows bridge is stopped
    remove_port_file(app);

    // Send shutdown signal to server loop
    let bridge = bridge(app);
    if let Some(tx) = bridge.shutdown_slot().await.take() {
        let _ = tx.send(());
    }

    // A write already emitted to a window may still apply there: answering
    // it "Bridge stopped" would invite a retry of a mutation that happened.
    // Taking the write lock waits for the writes queued ahead of this stop to
    // get their real answers; a write queued behind it is refused at
    // registration, before it is emitted. Bounded by a routed write's own
    // worst case, so a hung window cannot hold the stop forever — a write
    // still unanswered by then is the one ambiguous case: it is logged, and
    // its answer says the outcome is unknown.
    let write_guard = match writes {
        InFlightWrites::Await => {
            let waited =
                tokio::time::timeout(super::state::REQUEST_TIMEOUT_TOTAL, bridge.write_lock())
                    .await;
            if waited.is_err() {
                log::warn!("[MCP Bridge] Stopping with a write still unanswered by its window");
            }
            waited.ok()
        }
        InFlightWrites::Abandon => None,
    };

    // Close all client connections
    let mut guard = bridge.lock().await;

    // Invalidate in-flight handshakes FIRST (same lock the registration path
    // takes): a connection that authenticates after this drain re-checks the
    // generation and refuses to register — it must not survive shutdown.
    bridge.bump_connection_generation();

    // Shutdown all clients. Each connection's own teardown will find its
    // record gone, so the close is announced here, once per record.
    let mut closed = Vec::with_capacity(guard.clients.len());
    for (_, mut client) in guard.clients.drain() {
        if let Some(shutdown_tx) = client.shutdown.take() {
            let _ = shutdown_tx.send(());
        }
        closed.push(client.connection_id);
    }

    // Reject all pending requests. Holding the write lock, none of them is a
    // write; without it, one may be a write its window applied or will, so
    // the answer says so rather than inviting a blind retry.
    let stopped = if write_guard.is_some() {
        "Bridge stopped"
    } else {
        "Bridge stopped before the window answered; if this was a write, its outcome is unknown — read the current state before retrying"
    };
    for (_, pending) in guard.pending.drain() {
        let _ = pending.response_tx.send(McpResponse {
            success: false,
            data: None,
            error: Some(stopped.to_string()),
        });
    }
    drop(guard);
    // Writes queued behind the stop now find their client drained.
    drop(write_guard);
    // Rust-answered operations admitted before the drain finish first; none
    // can be admitted after it (`McpBridgeState::admit_operation`). Bounded
    // like the write wait: a coherence run outliving its own bound cannot be
    // abandoned, and an unbounded wait here would hang this stop and every
    // restart serialized behind it. Such a run still holds the write lock,
    // so a restarted bridge's writes queue behind it.
    let finished = tokio::time::timeout(
        super::state::REQUEST_TIMEOUT_TOTAL,
        bridge.await_operations(),
    )
    .await;
    if finished.is_err() {
        log::warn!("[MCP Bridge] Stopping with a Rust-side operation still running");
    }
    for connection_id in closed {
        announce_connection_closed(app, connection_id);
    }
}

/// The channel that writes back to `client_id`, if it is still connected.
///
/// ONE lookup. This was written out twice — once for the unsupported
/// envelope and once for a request — and the copies had drifted into two
/// missing-client policies that a reader had to diff to compare. The policies
/// still differ, and deliberately: an envelope nobody can be answered on is
/// dropped, while a request whose client has gone is reported. What they no
/// longer differ in is how the channel is FOUND; `identify`'s refusal reply
/// finds it here too.
pub(super) async fn client_sender(
    bridge: &McpBridgeState,
    client_id: u64,
) -> Option<mpsc::Sender<String>> {
    bridge
        .lock()
        .await
        .clients
        .get(&client_id)
        .map(|c| c.tx.clone())
}

/// Parse the MCP payload of a `request` envelope.
///
/// The envelope itself parsed fine, so the client message id is known — on a
/// malformed payload, answer the client with the parse error instead of
/// bubbling it up to the log-only message loop, which would leave the client
/// hanging until its own timeout.
async fn parse_request_or_reply(
    bridge: &McpBridgeState,
    msg_id: &str,
    payload: serde_json::Value,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
) -> Option<McpRequest> {
    match McpRequest::from_value(payload) {
        Ok(request) => Some(request),
        Err(e) => {
            log::warn!("[MCP Bridge] Client {client_id} sent request with invalid payload: {e}");
            send_error_response(bridge, client_id, client_tx, msg_id, &e).await;
            None
        }
    }
}

/// Handle an incoming WebSocket message.
///
/// Generic over the Tauri runtime so tests can drive the full path with
/// `tauri::test::MockRuntime`; production callers pass the default runtime.
pub(super) async fn handle_message<R: tauri::Runtime>(
    text: &str,
    client_id: u64,
    app: &AppHandle<R>,
) -> Result<(), String> {
    let bridge = bridge(app);
    let msg: WsMessage =
        serde_json::from_str(text).map_err(|e| format!("Invalid message format: {e}"))?;

    // Debug (dev only): shape and size, never text — a 256-char prefix of a
    // short insert IS the document. The two fields ARE client-chosen,
    // so they go through `peer_text`: bounded, and escaped so a newline in a
    // `type` cannot forge a log line of its own.
    #[cfg(debug_assertions)]
    log::debug!(
        "[MCP Bridge DEBUG] {} envelope id={} ({} bytes)",
        peer_text(&msg.msg_type),
        peer_text(&msg.id),
        text.len()
    );

    if msg.msg_type == "identify" {
        handle_identify(&msg.id, msg.payload, client_id, app).await;
        return Ok(());
    }

    if msg.msg_type != "request" {
        // A mistyped envelope must not hang the client until its own timeout —
        // answer with a correlated protocol error when a reply channel exists.
        if let Some(tx) = client_sender(bridge, client_id).await {
            send_error_response(
                bridge,
                client_id,
                &tx,
                &msg.id,
                &format!("Unsupported message type: {}", peer_text(&msg.msg_type)),
            )
            .await;
        }
        return Ok(());
    }

    // Fetch the client's tx channel up front — every later step (payload
    // parse failure, rust-side answer, overload, unknown window, response)
    // needs it to answer the client.
    let client_tx = client_sender(bridge, client_id)
        .await
        .ok_or("Client not found")?;

    let Some(request) =
        parse_request_or_reply(bridge, &msg.id, msg.payload, client_id, &client_tx).await
    else {
        return Ok(());
    };

    // Debug (dev only): a mutation's argument SIZE, never a value — the prefix
    // this replaces carried the inserted text itself. "Mutation" is whatever
    // the read/write classifier does not call read-only, so the diagnostic
    // follows the operation set instead of a list of names.
    #[cfg(debug_assertions)]
    if !super::state::is_read_only_operation(&request.request_type) {
        let bytes = serde_json::to_string(&request.args).map_or(0, |s| s.len());
        log::debug!(
            "[MCP Bridge DEBUG] {} args: {bytes} bytes",
            crate::peer_text::peer_text(&request.request_type)
        );
    }

    // Handle requests Rust answers directly (no webview) — incl. coherence
    // off-loop with the write lock. Per D2.3, delegated
    // authority binds to the principal the CONNECTION authenticated as, fixed
    // at auth time from the credential VMark issued to that AI client — not to
    // the name the client asserts in `identify`, which it may send and re-send.
    // See `principal.rs`.
    let principal = bridge.connection_principal(client_id).await;
    if let Some(response) = answer_rust_side(&request, app, principal, client_id).await {
        return deliver_response(
            bridge,
            client_id,
            &client_tx,
            msg.id,
            &response,
            "rust-side response could not be enqueued (queue full)",
        )
        .await;
    }

    super::routed_request::run(app, client_id, msg.id, request, &client_tx).await
}

#[cfg(test)]
#[path = "server.test.rs"]
mod tests;
