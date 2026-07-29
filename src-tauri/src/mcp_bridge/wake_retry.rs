//! App Nap wake-and-retry for `handle_message` (split from server.rs).
//!
//! macOS App Nap or display sleep can suspend the webview's JS loop, so a
//! request can time out while its event sits queued. The retry installs a
//! fresh response channel FIRST, wakes the webview, re-emits the SAME
//! request id (the webview deduplicates deliveries — useMcpBridge's
//! classifyDelivery), and waits once more.

use super::delivery::fail_pending;
use super::routing::wake_webview;
use super::state::{get_bridge_state, is_webview_alive, set_webview_alive, PendingRequest};
use super::types::{McpRequestEvent, McpResponse};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::{mpsc, oneshot};

/// The App Nap wake-and-retry tail of `handle_message`: install a fresh
/// response channel, wake the webview, re-emit the SAME request id (the
/// webview dispatcher deduplicates deliveries — see useMcpBridge's
/// classifyDelivery), and wait once more. Returns the response, or None when
/// the failure has already been answered to the client.
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
) -> Option<McpResponse> {
    // First timeout — try to wake the webview and retry once.
    // macOS App Nap or display sleep can suspend JS execution,
    // causing the frontend to miss emitted events.
    let webview_was_alive = is_webview_alive();
    set_webview_alive(false);
    log::warn!(
        "[MCP Bridge] Client {} request {} timed out after 10s (webview_alive={}), attempting wake + retry",
        client_id, request_type_for_log, webview_was_alive
    );

    // Install the retry channel BEFORE waking: once the webview
    // resumes, the QUEUED original event may execute immediately and
    // its response must land in this channel rather than the
    // already-abandoned first oneshot — otherwise a successful wake
    // recovery turns into a client timeout (cross-model review,
    // audit 20260612 remediation).
    let (retry_tx, retry_rx) = oneshot::channel();
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        // Replace the pending request with the new channel
        guard.pending.insert(
            request_id.to_string(),
            PendingRequest {
                response_tx: retry_tx,
                created_at: Instant::now(),
            },
        );
    }

    wake_webview(app, target_label).await;

    // Re-emit the event to the target window (not broadcast)
    if let Some(window) = app.get_webview_window(target_label) {
        if let Err(e) = window.emit("mcp-bridge:request", event) {
            log::warn!(
                "[MCP Bridge] Retry emit to window '{}' failed: {}",
                target_label,
                e
            );
            fail_pending(
                request_id,
                client_id,
                client_tx,
                msg_id,
                &format!(
                    "Failed to re-emit to window '{}' on retry: {}",
                    target_label, e
                ),
            )
            .await;
            return None;
        }
    } else {
        log::warn!(
            "[MCP Bridge] Target window '{}' no longer exists for retry",
            target_label
        );
        fail_pending(
            request_id,
            client_id,
            client_tx,
            msg_id,
            &format!("Target window '{}' was closed during retry", target_label),
        )
        .await;
        return None;
    }

    // Wait another 10 seconds for the retry
    let response = match tokio::time::timeout(Duration::from_secs(10), retry_rx).await {
        Ok(Ok(response)) => {
            log::info!(
                "[MCP Bridge] Retry succeeded for client {} request {}",
                client_id,
                request_type_for_log
            );
            response
        }
        Ok(Err(_)) => {
            // Retry channel closed
            log::warn!(
                "[MCP Bridge] Client {} request {} retry channel closed",
                client_id,
                request_type_for_log
            );
            fail_pending(
                request_id,
                client_id,
                client_tx,
                msg_id,
                "Response channel closed on retry",
            )
            .await;
            return None;
        }
        Err(_) => {
            // Final timeout after retry — give up
            log::warn!(
                "[MCP Bridge] Client {} request {} timed out after retry (20s total)",
                client_id,
                request_type_for_log
            );
            fail_pending(
                request_id,
                client_id,
                client_tx,
                msg_id,
                "Request timeout after 20s (including retry with webview wake)",
            )
            .await;
            return None;
        }
    };
    Some(response)
}
