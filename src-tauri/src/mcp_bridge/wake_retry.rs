//! App Nap wake-and-retry for `handle_message` (split from server.rs).
//!
//! macOS App Nap or display sleep can suspend the webview's JS loop, so a
//! request can time out while its event sits queued. The retry wakes the
//! webview, re-emits the SAME request id (the webview deduplicates
//! deliveries — useMcpBridge's classifyDelivery) and waits once more, on
//! the SAME response channel the first wait used.
//!
//! One channel for the whole request is what keeps an answer from being
//! lost: the queued original may execute the instant the webview resumes,
//! or may already have answered just after the first wait gave up, and
//! either answer lands in the receiver the request path still holds. The
//! re-send goes through `live_emit`, so a stop at any point before it means
//! nothing is re-sent, and stop's own "Bridge stopped" is the answer.
//!
//! @coordinates-with mcp_bridge/live_emit.rs — the re-send, checked under the tables lock
//! @coordinates-with mcp_bridge/session_fanout.rs — the per-window retry of a fan-out
//! @module mcp_bridge::wake_retry

use super::delivery::fail_pending;
use super::live_emit::{emit_while_live, LiveEmit};
use super::managed::bridge;
use super::routing::wake_webview;
use super::state::{REQUEST_TIMEOUT, REQUEST_TIMEOUT_TOTAL};
use super::types::{McpRequestEvent, McpResponse};
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};

/// The App Nap wake-and-retry tail of `handle_message`: wake the webview,
/// re-emit the SAME request id while it is still live, and wait once more
/// on `response_rx`. Returns the response, or None when the failure has
/// already been answered to the client.
#[allow(clippy::too_many_arguments)]
pub(super) async fn wake_retry_after_timeout<R: tauri::Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    request_id: &str,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: &str,
    request_type_for_log: &str,
    response_rx: &mut oneshot::Receiver<McpResponse>,
) -> Option<McpResponse> {
    retry_after_wake(
        app,
        target_label,
        event,
        request_id,
        client_id,
        client_tx,
        msg_id,
        request_type_for_log,
        response_rx,
        wake_webview(app, target_label),
    )
    .await
}

/// The retry with its wake step injected, so a test can stop the bridge at
/// exactly that point.
#[allow(clippy::too_many_arguments)]
async fn retry_after_wake<R: tauri::Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    request_id: &str,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
    msg_id: &str,
    request_type_for_log: &str,
    response_rx: &mut oneshot::Receiver<McpResponse>,
    wake: impl std::future::Future<Output = ()>,
) -> Option<McpResponse> {
    match retry_window(
        app,
        target_label,
        event,
        client_id,
        request_type_for_log,
        response_rx,
        wake,
    )
    .await
    {
        Ok(response) => Some(response),
        Err(error) => {
            fail_pending(
                bridge(app),
                request_id,
                client_id,
                client_tx,
                msg_id,
                &error,
            )
            .await;
            None
        }
    }
}

/// The wake-and-retry for one window of a fan-out (`session_fanout`): the
/// same wake, re-send and second wait, but the failure goes back to the
/// caller, which owns the pending entry and answers the client once for
/// every window together.
pub(super) async fn retry_window_after_timeout<R: tauri::Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    client_id: u64,
    request_type_for_log: &str,
    response_rx: &mut oneshot::Receiver<McpResponse>,
) -> Result<McpResponse, String> {
    retry_window(
        app,
        target_label,
        event,
        client_id,
        request_type_for_log,
        response_rx,
        wake_webview(app, target_label),
    )
    .await
}

/// Wake, re-send while live, wait once more. `Err` is the message the client
/// should be told; the pending entry is the caller's to remove.
async fn retry_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    client_id: u64,
    request_type_for_log: &str,
    response_rx: &mut oneshot::Receiver<McpResponse>,
    wake: impl std::future::Future<Output = ()>,
) -> Result<McpResponse, String> {
    // macOS App Nap or display sleep can suspend JS execution, causing the
    // frontend to miss emitted events.
    let bridge = bridge(app);
    let webview_was_alive = bridge.is_webview_alive();
    bridge.set_webview_alive(false);
    log::warn!(
        "[MCP Bridge] Client {} request {} timed out after {}s (webview_alive={}), attempting wake + retry",
        client_id,
        crate::peer_text::peer_text(request_type_for_log),
        REQUEST_TIMEOUT.as_secs(),
        webview_was_alive
    );

    wake.await;

    let refused = match emit_while_live(app, target_label, event, client_id).await {
        // Settled: the answer (or stop's) is already in `response_rx`.
        LiveEmit::Sent | LiveEmit::Settled => None,
        LiveEmit::ClientGone => Some("Client disconnected".to_string()),
        LiveEmit::NoWindow => {
            log::warn!("[MCP Bridge] Target window {target_label:?} no longer exists for retry");
            Some(format!(
                "Target window '{target_label}' was closed during retry"
            ))
        }
        LiveEmit::Failed(e) => {
            log::warn!("[MCP Bridge] Retry emit to window {target_label:?} failed: {e}");
            Some(format!(
                "Failed to re-emit to window '{target_label}' on retry: {e}"
            ))
        }
    };
    if let Some(error) = refused {
        return Err(error);
    }

    // Wait one more attempt's worth.
    let failure = match tokio::time::timeout(REQUEST_TIMEOUT, response_rx).await {
        Ok(Ok(response)) => {
            log::info!(
                "[MCP Bridge] Retry succeeded for client {} request {}",
                client_id,
                crate::peer_text::peer_text(request_type_for_log)
            );
            return Ok(response);
        }
        Ok(Err(_)) => {
            log::warn!(
                "[MCP Bridge] Client {} request {} retry channel closed",
                client_id,
                crate::peer_text::peer_text(request_type_for_log)
            );
            "Response channel closed on retry".to_string()
        }
        Err(_) => {
            log::warn!(
                "[MCP Bridge] Client {} request {} timed out after retry ({}s total)",
                client_id,
                crate::peer_text::peer_text(request_type_for_log),
                REQUEST_TIMEOUT_TOTAL.as_secs()
            );
            format!(
                "Request timeout after {}s (including retry with webview wake)",
                REQUEST_TIMEOUT_TOTAL.as_secs()
            )
        }
    };
    Err(failure)
}

#[cfg(all(test, not(target_os = "windows")))]
#[path = "wake_retry.test.rs"]
mod tests;
