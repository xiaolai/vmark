//! `vmark.session.get_state` across every document window (#1612).
//!
//! Each window's webview holds only its own tabs, so a routed request — sent
//! to ONE window — can only ever describe that window. Before this, the
//! answer was whichever window routing picked: with no VMark window focused
//! (the user typing in their AI client) that was `main`, and a Finder-opened
//! `doc-N` window was invisible to the client.
//!
//! The request is sent to every document window (`main`, `doc-*`) at once,
//! each under its own pending entry, and the answers are merged into one
//! session: each window contributes only the record carrying its own label,
//! so a stale record one webview keeps for another window cannot shadow that
//! window's own answer.
//!
//! Key decisions:
//!   - Fail loud. One window refusing or never answering (after the same App
//!     Nap wake-and-retry a routed request gets) fails the whole request,
//!     naming the window. A session missing a window looks complete to the
//!     client, which is the defect this module exists to remove.
//!   - A window closed at any point before it answers is skipped: it is no
//!     longer part of the session. Closing does not drop its pending entry,
//!     so this is noticed when its wait times out.
//!   - `focused` is stamped here from ONE reading, taken once every window has
//!     answered. Each webview reads focus on its own, at its own moment, so
//!     two answers can both claim it; the stamp keeps at most one window
//!     focused. A window whose focus cannot be read counts as unfocused, as
//!     in `routing.rs`.
//!   - Read-only, so no write lock; the per-window entries count against the
//!     pending cap like any other request.
//!
//! @coordinates-with mcp_bridge/server.rs — dispatches the operation here
//! @coordinates-with mcp_bridge/wake_retry.rs — the per-window retry
//! @coordinates-with mcp_bridge/live_emit.rs — each send, checked under the tables lock
//! @coordinates-with src/services/mcpBridge/v2/session.ts — what each window answers
//! @module mcp_bridge::session_fanout

use futures_util::future::join_all;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{mpsc, oneshot};

use super::attribution::register_attributed;
use super::delivery::deliver_response;
use super::live_emit::{emit_while_live, LiveEmit};
use super::managed::bridge;
use super::routed_request::next_bridge_request_id;
use super::state::REQUEST_TIMEOUT;
use super::types::{McpRequest, McpRequestEvent, McpResponse};
use super::wake_retry::retry_window_after_timeout;

/// The operation answered by asking every document window.
pub(super) const SESSION_GET_STATE: &str = "vmark.session.get_state";

/// Ask every document window for its part of the session and answer the
/// client once with the merged result.
pub(super) async fn run<R: Runtime>(
    app: &AppHandle<R>,
    client_id: u64,
    msg_id: String,
    request: McpRequest,
    client_tx: &mpsc::Sender<String>,
) -> Result<(), String> {
    let args_json = serde_json::to_string(&request.args).unwrap_or_else(|_| "{}".to_string());
    let labels = document_window_labels(app);
    let answers = join_all(
        labels
            .iter()
            .map(|label| ask_window(app, label, &request.request_type, &args_json, client_id)),
    )
    .await;
    let focused = focused_window_label(app);
    let response = match merge(
        labels.iter().map(String::as_str).zip(answers),
        focused.as_deref(),
    ) {
        Ok(data) => McpResponse {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(error) => {
            log::warn!("[MCP Bridge] Client {client_id} session.get_state failed: {error}");
            McpResponse {
                success: false,
                data: None,
                error: Some(error),
            }
        }
    };
    deliver_response(
        bridge(app),
        client_id,
        client_tx,
        msg_id,
        &response,
        "session response could not be enqueued (queue full)",
    )
    .await
}

/// The open document windows: `main` first, then `doc-N` by number, so the
/// session lists windows in a stable order.
fn document_window_labels<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| label == "main" || label.starts_with("doc-"))
        .collect();
    labels.sort_by_key(|label| {
        let number = label
            .strip_prefix("doc-")
            .and_then(|n| n.parse::<u64>().ok());
        (label != "main", number.is_none(), number, label.clone())
    });
    labels
}

/// The window holding focus right now, if any.
fn focused_window_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

/// One window's answer: its data, `None` when it closed before it could be
/// asked, or the error the client should see.
async fn ask_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    request_type: &str,
    args_json: &str,
    client_id: u64,
) -> Result<Option<Value>, String> {
    let (response_tx, mut response_rx) = oneshot::channel();
    let request_id = next_bridge_request_id();
    let attribution = {
        let mut guard = bridge(app).lock().await;
        register_attributed(&mut guard, client_id, request_id.clone(), response_tx)?
    };
    let event = McpRequestEvent {
        id: request_id.clone(),
        request_type: request_type.to_string(),
        args_json: args_json.to_string(),
        attribution,
    };
    let answer = match emit_while_live(app, label, &event, client_id).await {
        LiveEmit::Sent | LiveEmit::Settled => {
            await_window(app, label, &event, client_id, &mut response_rx).await
        }
        LiveEmit::NoWindow => Ok(None),
        LiveEmit::ClientGone => Err("Client disconnected".to_string()),
        LiveEmit::Failed(e) => Err(format!("Failed to emit event: {e}")),
    };
    // Settled, answered or failed, the entry is done with; removing it is a
    // no-op when the webview's answer (or a stop) already took it.
    bridge(app).lock().await.pending.remove(&request_id);
    answer.map_err(|error| format!("window '{label}': {error}"))
}

/// Wait for one window, with the routed path's App Nap wake-and-retry.
/// `None` when the window closed before it answered.
async fn await_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    event: &McpRequestEvent,
    client_id: u64,
    response_rx: &mut oneshot::Receiver<McpResponse>,
) -> Result<Option<Value>, String> {
    let response = match tokio::time::timeout(REQUEST_TIMEOUT, &mut *response_rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => return Err("Response channel closed".to_string()),
        Err(_) if window_closed(app, label) => return Ok(None),
        Err(_) => {
            match retry_window_after_timeout(
                app,
                label,
                event,
                client_id,
                SESSION_GET_STATE,
                response_rx,
            )
            .await
            {
                Ok(response) => response,
                Err(_) if window_closed(app, label) => return Ok(None),
                Err(error) => return Err(error),
            }
        }
    };
    if !response.success {
        return Err(response
            .error
            .unwrap_or_else(|| "request failed without an error message".to_string()));
    }
    Ok(Some(response.data.unwrap_or(Value::Null)))
}

fn window_closed<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    app.get_webview_window(label).is_none()
}

/// Merge each window's answer into one session: its own window record, with
/// `focused` stamped from the bridge's one reading, and the capabilities of
/// the first window that answered.
fn merge<'a>(
    answers: impl IntoIterator<Item = (&'a str, Result<Option<Value>, String>)>,
    focused: Option<&str>,
) -> Result<Value, String> {
    let mut windows = Vec::new();
    let mut capabilities = None;
    for (label, answer) in answers {
        let Some(data) = answer? else { continue };
        let own = data
            .get("windows")
            .and_then(Value::as_array)
            .and_then(|records| {
                records
                    .iter()
                    .find(|record| record.get("label").and_then(Value::as_str) == Some(label))
            })
            .ok_or_else(|| format!("window '{label}' did not report its own window record"))?;
        let mut own = own.clone();
        own["focused"] = Value::Bool(focused == Some(label));
        windows.push(own);
        if capabilities.is_none() {
            capabilities = data.get("capabilities").cloned();
        }
    }
    let capabilities = capabilities.ok_or("No document window is open")?;
    Ok(serde_json::json!({ "windows": windows, "capabilities": capabilities }))
}

#[cfg(all(test, not(target_os = "windows")))]
#[path = "session_fanout.test.rs"]
mod tests;
