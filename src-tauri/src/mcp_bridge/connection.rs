//! Per-connection lifecycle for the MCP bridge WebSocket server.
//!
//! Split out of `server.rs` (WI-9). The ordering here is the security
//! property: a peer gets a connection slot, an origin-checked and
//! size-capped WebSocket, and a chance to present its token — and *nothing
//! else* — until it authenticates. Only then does it cost the process a
//! 1024-slot outbound queue and an entry in the shared `clients` map.
//!
//! The pre-auth rules themselves live in `handshake.rs`.

use super::frames::{auth_result_frame, send_frame, welcome_frame, WsSink};
use super::handshake::{
    await_auth, check_upgrade_request, AuthOutcome, ConnectionSlot, AUTH_DEADLINE,
    MAX_CONCURRENT_CONNECTIONS,
};
use super::message_loop::run_message_loop;
use super::principal::BridgePrincipal;
use super::state::{get_bridge_state, ClientConnection, CLIENT_TX_CAPACITY};
use crate::mcp_config::client_tokens;
use futures_util::{FutureExt, SinkExt, StreamExt};
use std::future::Future;
use std::net::SocketAddr;
use std::panic::AssertUnwindSafe;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_hdr_async_with_config, tungstenite::Message};

/// Admit one freshly accepted socket, or refuse it outright.
///
/// The connection slot is taken **here**, synchronously in the accept loop,
/// and moved into the spawned task. Acquiring it inside the task instead
/// (audit round 1, finding 4) bounded nothing: the loop kept accepting
/// sockets and spawning tasks — each with a cloned `AppHandle` and a cloned
/// token — that only discovered they were over the cap once they were
/// scheduled, so a flood produced an unbounded pre-auth backlog. Refusing
/// before `spawn` is what makes [`MAX_CONCURRENT_CONNECTIONS`] a real ceiling.
///
/// Returns whether the connection was admitted. On refusal `stream` is
/// dropped here, which closes the socket immediately, and nothing is cloned.
pub(super) fn admit_connection<R: tauri::Runtime>(
    stream: TcpStream,
    addr: SocketAddr,
    app: &AppHandle<R>,
    expected_token: &str,
) -> bool {
    let Some(slot) = ConnectionSlot::try_acquire() else {
        log::warn!(
            "[MCP Bridge] Refusing connection from {addr}: at capacity ({}/{})",
            ConnectionSlot::live(),
            MAX_CONCURRENT_CONNECTIONS
        );
        return false;
    };
    // Captured at admission: if the bridge stops (or restarts) while this
    // connection is mid-handshake, registration re-checks the generation and
    // refuses — an authenticated stray must not outlive its bridge.
    let admitted_generation = super::state::connection_generation();
    crate::task::spawn_logged(
        "mcp-bridge-connection",
        handle_connection(
            stream,
            addr,
            app.clone(),
            expected_token.to_string(),
            slot,
            admitted_generation,
        ),
    );
    true
}

/// Mint the next client id without registering anything.
///
/// A counter bump, not an allocation: the id is needed for the welcome frame
/// and the auth-phase logs, and pre-minting it keeps the wire format
/// unchanged while the `clients` entry stays behind authentication.
async fn mint_client_id() -> u64 {
    let state = get_bridge_state();
    let mut guard = state.lock().await;
    let id = guard.next_client_id;
    guard.next_client_id += 1;
    id
}

/// Handle a single WebSocket connection, from TCP accept to cleanup.
///
/// `_slot` is the capacity reservation [`admit_connection`] already took; it
/// is owned here so it is released on every exit path, including a panic.
///
/// Generic over the Tauri runtime so tests can drive the real path with
/// `tauri::test::MockRuntime`; production passes the default runtime.
async fn handle_connection<R: tauri::Runtime>(
    stream: TcpStream,
    addr: SocketAddr,
    app: AppHandle<R>,
    expected_token: String,
    _slot: ConnectionSlot,
    admitted_generation: u64,
) {
    let ws_stream = match accept_hdr_async_with_config(
        stream,
        check_upgrade_request,
        Some(super::handshake::ws_config()),
    )
    .await
    {
        Ok(ws) => ws,
        Err(e) => {
            log::warn!("[MCP Bridge] WebSocket handshake failed for {addr}: {e}");
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let client_id = mint_client_id().await;
    log::debug!("[MCP Bridge] Peer {client_id} connected from {addr}");

    if !send_frame(&mut ws_sender, &welcome_frame(client_id)).await {
        return;
    }

    // --- Auth phase: no queue, no client record, writes go straight out ---
    //
    // The credential registry is snapshotted PER CONNECTION, not captured at
    // bridge start: a user who runs Install while VMark is running would
    // otherwise see nothing happen until the app was restarted.
    let configured = client_tokens::snapshot();
    let outcome = tokio::time::timeout(
        AUTH_DEADLINE,
        await_auth(&mut ws_receiver, &expected_token, &configured, client_id),
    )
    .await
    .unwrap_or(AuthOutcome::Aborted);

    let principal = match outcome {
        AuthOutcome::Accepted(principal) => {
            send_frame(&mut ws_sender, &auth_result_frame(true)).await;
            log::debug!(
                "[MCP Bridge] Client {client_id} authenticated as {}",
                principal.label()
            );
            principal
        }
        AuthOutcome::Rejected => {
            // `send` flushes, so the rejection is on the wire before the
            // close — no sleep-and-hope needed now that the auth phase
            // writes to the socket directly.
            send_frame(&mut ws_sender, &auth_result_frame(false)).await;
            let _ = ws_sender.close().await;
            log::warn!("[MCP Bridge] Peer {client_id} rejected: auth failed");
            return;
        }
        AuthOutcome::Aborted => {
            let _ = ws_sender.close().await;
            log::warn!("[MCP Bridge] Peer {client_id} auth timeout or transport error");
            return;
        }
    };

    serve_authenticated(
        ws_sender,
        &mut ws_receiver,
        client_id,
        principal,
        &app,
        admitted_generation,
    )
    .await;
}

/// Register the authenticated peer, pump its frames, and always tear it down.
///
/// `principal` is written into the client record here, once, and never
/// rewritten: `handle_identify` may change the *label* a client shows, and
/// must never change who it is.
async fn serve_authenticated<R: tauri::Runtime, S>(
    mut ws_sender: WsSink,
    ws_receiver: &mut S,
    client_id: u64,
    principal: BridgePrincipal,
    app: &AppHandle<R>,
    admitted_generation: u64,
) where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    // --- Authenticated: only now does this peer cost us anything ---
    let (tx, mut rx) = mpsc::channel::<String>(CLIENT_TX_CAPACITY);
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let connection = ClientConnection {
        tx,
        shutdown: Some(shutdown_tx),
        identity: None,
        principal,
    };
    if !super::state::try_register_client(client_id, connection, admitted_generation).await {
        log::warn!(
            "[MCP Bridge] Client {client_id} authenticated during bridge shutdown — refused"
        );
        let _ = ws_sender.close().await;
        return;
    }

    let send_task = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    unregister_after(
        client_id,
        app,
        send_task,
        run_message_loop(ws_receiver, &mut shutdown_rx, client_id, app),
    )
    .await;
}

/// Run `body` to completion — panicking or not — then always remove the
/// client record and abort its writer task.
///
/// `spawn_logged` absorbs a panic at the TASK boundary, which is exactly why
/// this exists (audit round 1, finding 6): before it, a panic anywhere in
/// message handling skipped the cleanup below, so the `clients` entry
/// survived holding a live `tx`, and the detached writer task stayed parked
/// on `rx.recv()` for the rest of the process's life. Cleanup cannot be a
/// `Drop` impl — removing the entry needs the async state lock.
async fn unregister_after<R: tauri::Runtime, F: Future<Output = ()>>(
    client_id: u64,
    app: &AppHandle<R>,
    send_task: tauri::async_runtime::JoinHandle<()>,
    body: F,
) {
    if let Err(payload) = AssertUnwindSafe(body).catch_unwind().await {
        log::error!(
            "[MCP Bridge] Client {client_id} message loop panicked: {} — tearing the connection down",
            crate::task::panic_payload_message(&payload)
        );
    }

    // Cleanup. F6 (WI-3.5, D4.2): disconnect removes ONLY the client record
    // — never tabs, never a window's workspace (disconnect_preserves_* test).
    let had_identity = {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        match guard.clients.remove(&client_id) {
            Some(client) => {
                let name = client
                    .identity
                    .as_ref()
                    .map(|i| i.display_name())
                    .unwrap_or_else(|| format!("Client {client_id}"));
                log::debug!(
                    "[MCP Bridge] {name} disconnected. Remaining clients: {}",
                    guard.clients.len()
                );
                client.identity.is_some()
            }
            None => false,
        }
    };

    // Notify frontend when an identified client disconnects
    if had_identity {
        let _ = app.emit("mcp-bridge:clients-changed", ());
    }

    send_task.abort();
}

#[cfg(test)]
#[path = "connection.test.rs"]
mod tests;
