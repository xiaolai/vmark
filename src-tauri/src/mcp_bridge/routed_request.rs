//! One routed request: the stage that reaches a WINDOW and waits for it.
//!
//! Split out of `handle_message` (#376/#381), which had grown to 232 lines
//! across two unrelated jobs — deciding what an envelope IS, and driving a
//! request all the way to a webview and back. This half is the second job, in
//! its own order, which is the part that matters:
//!
//!   1. take the write lock for a write-class operation, so writes serialize
//!      while reads run together;
//!   2. register the pending request (which sweeps stale entries, enforces the
//!      overload cap and refuses a client a stop already drained — #379);
//!   3. route to the owning window and emit, each step answering the client
//!      itself when it refuses (F5, WI-3.5);
//!   4. wait [`REQUEST_TIMEOUT`], with one App Nap wake-and-retry;
//!   5. deliver, with the write lock already released.
//!
//! @coordinates-with mcp_bridge/server.rs — the envelope dispatcher above it
//! @coordinates-with mcp_bridge/routing.rs — the window the request goes to
//! @coordinates-with mcp_bridge/wake_retry.rs — the second attempt
//! @module mcp_bridge::routed_request

use std::future::Future;

use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};

use super::delivery::{deliver_response, fail_pending};
use super::managed::bridge;
use super::routing::{emit_to_window_or_reply, route_target_or_reply};
use super::state::{is_read_only_operation, try_register_pending_for, REQUEST_TIMEOUT};
use super::types::{McpRequest, McpRequestEvent};
use super::wake_retry::wake_retry_after_timeout;

/// Monotonic counter behind `next_bridge_request_id`.
///
/// A process-global counter is deliberate, and rule 50 §10 names this symbol:
/// it is an id source, not mutable STATE — nothing reads it back, and two
/// bridges in one process wanting overlapping ids would be a defect, not a
/// feature.
static NEXT_REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Mint a bridge-internal request id.
///
/// Pending requests — and the events emitted to the frontend, which echoes
/// the event id back via `mcp_bridge_respond` — are keyed by this id rather
/// than the client-supplied message id: two connected sidecars generate their
/// message ids independently and can collide, and a collision in the pending
/// map would silently drop one client's response channel and route its
/// response to the other. The client's own message id is only used when
/// writing the WebSocket response back to that client.
pub(super) fn next_bridge_request_id() -> String {
    format!(
        "bridge-{}",
        NEXT_REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// Await `deliver` with the global write lock already released.
///
/// Rust drops a guard at the END of its scope — i.e. *after* the delivery
/// await — so the release has to be explicit. It used to only look explicit:
/// the guard was bound as `let _write_guard`, a comment above the final
/// `deliver_response` claimed the lock was already gone, and it was not
/// (audit round 1, finding 8). Delivery can force-disconnect a backpressured
/// peer, which takes the bridge state lock, so every other write operation
/// queued behind one slow client's teardown.
///
/// Taking the guard by value and dropping it before the await makes the
/// ordering a property of this function, and one a test can observe from
/// inside `deliver`.
async fn without_write_lock<T>(
    write_guard: Option<tokio::sync::MutexGuard<'_, ()>>,
    deliver: impl Future<Output = T>,
) -> T {
    drop(write_guard);
    deliver.await
}

/// Drive `request` to its window and answer the client.
pub(super) async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    client_id: u64,
    msg_id: String,
    request: McpRequest,
    client_tx: &mpsc::Sender<String>,
) -> Result<(), String> {
    let bridge = bridge(app);
    let is_read = is_read_only_operation(&request.request_type);

    // For write operations, acquire the write lock: writes go one at a time
    // while reads run together.
    let write_guard = if is_read {
        None
    } else {
        log::debug!(
            "[MCP Bridge] Client {} acquiring write lock for {}",
            client_id,
            request.request_type
        );
        Some(bridge.write_lock().await)
    };

    let (response_tx, response_rx) = oneshot::channel();
    let request_id = next_bridge_request_id();
    let request_type_for_log = request.request_type.clone();

    // Store the pending request (sweeps stale entries, enforces the overload
    // cap, and refuses a client a stop already drained — #379). The state lock
    // is released before responding: send_error_response may force-disconnect.
    let registered = {
        let mut guard = bridge.lock().await;
        try_register_pending_for(&mut guard, client_id, request_id.clone(), response_tx)
    };
    if let Err(err) = registered {
        log::warn!("[MCP Bridge] Client {client_id} request rejected: {err}");
        // Answer the client instead of silently dropping the request —
        // otherwise it hangs until its own timeout.
        super::delivery::send_error_response(bridge, client_id, client_tx, &msg_id, &err).await;
        return Ok(());
    }

    // Emit to the target window (never broadcast): each window has its own
    // webview with independent editor state, so the wrong one is a
    // cross-window content leak. Args are serialized to a JSON string to
    // avoid Tauri IPC double-encoding.
    let args_json = serde_json::to_string(&request.args).unwrap_or_else(|_| "{}".to_string());
    let event = McpRequestEvent {
        id: request_id.clone(),
        request_type: request.request_type.clone(),
        args_json,
    };

    // F5 (WI-3.5): route by owning workspace, fail loud on ambiguity /
    // conflict / missing window (helper replies + cleans up on refusal).
    let Some(target_label) =
        route_target_or_reply(&request, app, &request_id, client_id, client_tx, &msg_id).await
    else {
        return Ok(());
    };
    // Emit to the target window; helper replies + cleans up if the window
    // vanished (TOCTOU) or the emit failed, returning false to stop here.
    if !emit_to_window_or_reply(
        app,
        &target_label,
        &event,
        &request.request_type,
        &request_id,
        client_id,
        client_tx,
        &msg_id,
    )
    .await
    {
        return Ok(());
    }

    let Some(response) = await_response(
        app,
        &target_label,
        &event,
        &request_id,
        client_id,
        client_tx,
        &msg_id,
        &request_type_for_log,
        response_rx,
    )
    .await
    else {
        return Ok(());
    };

    if !is_read {
        log::debug!(
            "[MCP Bridge] Client {client_id} completed {request_type_for_log} - releasing write lock"
        );
    }

    // Send the response back to the client with the write lock already
    // released — `without_write_lock` drops the guard before it awaits.
    without_write_lock(
        write_guard,
        deliver_response(
            bridge,
            client_id,
            client_tx,
            msg_id,
            &response,
            "request response could not be enqueued (queue full)",
        ),
    )
    .await?;

    Ok(())
}

/// Wait for the window's answer: once, then once more behind an App Nap wake.
/// `None` when the failure has already been answered to the client.
#[allow(clippy::too_many_arguments)]
async fn await_response<R: tauri::Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    request_id: &str,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: &str,
    request_type_for_log: &str,
    response_rx: oneshot::Receiver<super::types::McpResponse>,
) -> Option<super::types::McpResponse> {
    match tokio::time::timeout(REQUEST_TIMEOUT, response_rx).await {
        Ok(Ok(response)) => Some(response),
        Ok(Err(_)) => {
            // Channel closed — clean up and tell the sidecar.
            fail_pending(
                bridge(app),
                request_id,
                client_id,
                client_tx,
                msg_id,
                "Response channel closed",
            )
            .await;
            None
        }
        Err(_) => {
            wake_retry_after_timeout(
                app,
                target_label,
                event,
                request_id,
                client_id,
                client_tx,
                msg_id,
                request_type_for_log,
            )
            .await
        }
    }
}

#[cfg(test)]
#[path = "routed_request.test.rs"]
mod tests;
