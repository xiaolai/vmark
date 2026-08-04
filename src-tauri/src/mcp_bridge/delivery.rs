//! Outbound message delivery to MCP sidecar clients.
//!
//! Moved out of `server.rs`: the bounded-queue enqueue policy, the
//! force-disconnect escalation for lost load-bearing messages, and the
//! response/error envelope writers used by the connection and message loops.

use super::managed::McpBridgeState;
use super::state::CLIENT_TX_CAPACITY;
use super::types::{McpResponse, WsMessage};
use tokio::sync::mpsc;

/// Outcome of an `enqueue_client_msg` attempt.
///
/// `Sent` is the happy path. The two failure variants distinguish "client is
/// alive but backpressured beyond the cap" from "client is gone" so callers
/// can pick the right policy — silent drop for notifications, disconnect for
/// in-flight request responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EnqueueOutcome {
    Sent,
    QueueFull,
    Closed,
}

/// Enqueue an outbound message on a client's bounded channel.
///
/// Uses `try_send` so the server is never blocked by a slow client. On a
/// full queue or closed receiver the message is dropped at this layer and
/// the outcome is returned so callers can take protocol-level action when
/// the dropped message is load-bearing (e.g. a request response). Both
/// failure cases are logged here so call sites only need to act on the
/// returned outcome.
pub(super) fn enqueue_client_msg(
    client_id: u64,
    tx: &mpsc::Sender<String>,
    msg: String,
) -> EnqueueOutcome {
    match tx.try_send(msg) {
        Ok(()) => EnqueueOutcome::Sent,
        Err(mpsc::error::TrySendError::Full(_)) => {
            log::warn!(
                "[MCP Bridge] Client {} outbound queue full (cap {}) — dropping message",
                client_id,
                CLIENT_TX_CAPACITY
            );
            EnqueueOutcome::QueueFull
        }
        Err(mpsc::error::TrySendError::Closed(_)) => {
            log::debug!(
                "[MCP Bridge] Client {} send channel closed — dropping message",
                client_id
            );
            EnqueueOutcome::Closed
        }
    }
}

/// Signal the shutdown channel for a client so its read/write tasks tear
/// down promptly. Used after dropping a load-bearing message (e.g. a
/// request response) — leaving the client connected after losing a
/// response would otherwise let it hang waiting for a reply that will
/// never arrive.
pub(super) async fn force_disconnect_client(bridge: &McpBridgeState, client_id: u64, reason: &str) {
    let mut guard = bridge.lock().await;
    if let Some(client) = guard.clients.get_mut(&client_id) {
        if let Some(shutdown_tx) = client.shutdown.take() {
            let _ = shutdown_tx.send(());
            log::warn!(
                "[MCP Bridge] Forcing client {} disconnect: {}",
                client_id,
                reason
            );
        }
    }
}

/// Send an error response back to the MCP sidecar client.
///
/// Async because dropping a response (queue full or closed) is treated as
/// a transport failure — silently losing an in-flight response leaves the
/// client hanging on `await` forever. On `EnqueueOutcome::QueueFull` or
/// `Closed`, the client is forced to disconnect so it can reconnect and
/// retry, instead of waiting indefinitely for a reply that won't arrive.
pub(super) async fn send_error_response(
    bridge: &McpBridgeState,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: &str,
    error: &str,
) {
    let error_response = McpResponse {
        success: false,
        data: None,
        error: Some(error.to_string()),
    };
    let ws_response = WsMessage {
        id: msg_id.to_string(),
        msg_type: "response".to_string(),
        payload: serde_json::to_value(&error_response).unwrap_or_default(),
    };
    if let Ok(json) = serde_json::to_string(&ws_response) {
        match enqueue_client_msg(client_id, client_tx, json) {
            EnqueueOutcome::Sent => {}
            EnqueueOutcome::QueueFull => {
                force_disconnect_client(
                    bridge,
                    client_id,
                    "error-response could not be enqueued (queue full)",
                )
                .await;
            }
            EnqueueOutcome::Closed => {
                // Already gone — nothing to disconnect.
            }
        }
    }
}

/// Serialize a response envelope and enqueue it on the client's channel.
///
/// Shared by the rust-side answer path and the final response path of
/// `handle_message`. On `QueueFull` the client is force-disconnected with
/// `queue_full_reason` so it reconnects and retries rather than hanging on
/// its `await` indefinitely; `Closed` means the client is already gone.
pub(super) async fn deliver_response(
    bridge: &McpBridgeState,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: String,
    response: &McpResponse,
    queue_full_reason: &str,
) -> Result<(), String> {
    let ws_response = WsMessage {
        id: msg_id,
        msg_type: "response".to_string(),
        payload: serde_json::to_value(response).unwrap_or_default(),
    };
    let response_json =
        serde_json::to_string(&ws_response).map_err(|e| format!("Failed to serialize: {}", e))?;
    match enqueue_client_msg(client_id, client_tx, response_json) {
        EnqueueOutcome::Sent | EnqueueOutcome::Closed => Ok(()),
        EnqueueOutcome::QueueFull => {
            force_disconnect_client(bridge, client_id, queue_full_reason).await;
            Ok(())
        }
    }
}

/// Drop a pending request and answer its client with `error`.
///
/// The one cleanup policy for "this request will never be answered by the
/// frontend", shared by every caller: the timeout and retry paths in
/// `server.rs` and the routing/emit refusals in `routing.rs`. It lived as a
/// private helper in `server.rs`, so `routing.rs` carried its own copies of
/// the same remove-unlock-send sequence and the policy was split across
/// modules (audit round 1, finding 7).
///
/// The state lock is released before answering: `send_error_response` may
/// force-disconnect, which re-locks it.
pub(super) async fn fail_pending(
    bridge: &McpBridgeState,
    request_id: &str,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: &str,
    error: &str,
) {
    bridge.lock().await.pending.remove(request_id);
    log::warn!("[MCP Bridge] Client {client_id} request failed: {error}");
    send_error_response(bridge, client_id, client_tx, msg_id, error).await;
}

#[cfg(test)]
#[path = "delivery.test.rs"]
mod tests;
