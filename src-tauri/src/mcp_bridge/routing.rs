//! Window routing and Rust-side request handling for the MCP bridge.
//!
//! Helpers moved out of `server.rs`: resolving the target webview window for
//! a bridge request, waking a suspended webview, and answering requests that
//! Rust can handle natively without involving the webview.

use super::delivery::fail_pending;
use super::live_emit::{emit_while_live, LiveEmit};
use super::managed::bridge;
use super::principal::BridgePrincipal;
use super::types::{McpRequest, McpRequestEvent, McpResponse};
use crate::coherence::commands::CoherenceState;
use tauri::AppHandle;
use tauri::Manager;
use tauri::Runtime;
use tokio::sync::mpsc::Sender;

/// Try to wake the target webview by evaluating a no-op JS snippet.
///
/// When macOS suspends the webview (App Nap, display sleep), emitted events
/// are queued but the frontend JS never executes. Calling the Tauri webview
/// eval API nudges the webview process and can revive the JS event loop.
pub(super) async fn wake_webview<R: Runtime>(app: &AppHandle<R>, target_label: &str) {
    if let Some(window) = app.get_webview_window(target_label) {
        log::debug!(
            "[MCP Bridge] Attempting to wake webview {:?} via Tauri eval API",
            target_label
        );
        if let Err(e) = window.eval("void(0)") {
            log::debug!(
                "[MCP Bridge] Failed to wake webview {:?}: {} (continuing anyway)",
                target_label,
                e
            );
        }
    } else {
        log::warn!(
            "[MCP Bridge] Cannot wake webview — window {:?} not found",
            target_label
        );
    }
}

/// Emit a routed request to its target window, only while it is still
/// pending for its connected client (`live_emit`). If the window vanished
/// (a close raced the routing snapshot), the client disconnected or the emit
/// failed, clean up the pending entry and reply to the client with the
/// error. Returns `false` when it has already replied — the caller returns.
/// A request a stop already drained is not sent; `true` lets the caller
/// collect stop's answer from the request's own channel.
#[allow(clippy::too_many_arguments)]
pub(super) async fn emit_to_window_or_reply<R: Runtime>(
    app: &AppHandle<R>,
    target_label: &str,
    event: &McpRequestEvent,
    request_type: &str,
    request_id: &str,
    client_id: u64,
    client_tx: &Sender<String>,
    msg_id: &str,
) -> bool {
    log::debug!(
        "[MCP Bridge] Emitting mcp-bridge:request to {target_label:?} for {} (id: {})",
        crate::peer_text::peer_text(request_type),
        crate::peer_text::peer_text(request_id)
    );
    let err = match emit_while_live(app, target_label, event, client_id).await {
        LiveEmit::Sent | LiveEmit::Settled => return true,
        LiveEmit::ClientGone => "Client disconnected".to_string(),
        LiveEmit::NoWindow => format!("Target window '{target_label}' not found"),
        LiveEmit::Failed(e) => format!("Failed to emit event: {e}"),
    };
    fail_pending(bridge(app), request_id, client_id, client_tx, msg_id, &err).await;
    false
}

/// F5: resolve the target window for a frontend-routed request from a
/// snapshot of every window's workspace, tabs and focus history
/// (`window_routing.rs` decides: the window holding an explicit `tabId`, else
/// workspace scoping, else focus, else the last focused window). On a routing refusal (ambiguity) it removes the pending entry,
/// replies to the client with the error, and returns `None` — the caller returns.
pub(super) async fn route_target_or_reply<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
    request_id: &str,
    client_id: u64,
    client_tx: &Sender<String>,
    msg_id: &str,
) -> Option<String> {
    let (workspaces, tabs) = {
        let guard = bridge(app).lock().await;
        (guard.window_workspaces.clone(), guard.window_tabs.clone())
    };
    let last_focused = crate::window_manager::file_open_state(app)
        .lock()
        .last_focused_document_window()
        .map(str::to_string);
    let candidates: Vec<super::window_routing::WindowCandidate> = app
        .webview_windows()
        .values()
        .map(|w| {
            let label = w.label().to_string();
            super::window_routing::WindowCandidate {
                workspace: workspaces.get(&label).cloned(),
                tabs: tabs.get(&label).cloned().unwrap_or_default(),
                focused: w.is_focused().unwrap_or(false),
                last_focused: last_focused.as_deref() == Some(label.as_str()),
                is_document: label == "main" || label.starts_with("doc-"),
                label,
            }
        })
        .collect();
    match super::window_routing::pick_target_window_for(&request.args, &candidates) {
        Ok(label) => Some(label),
        Err(err) => {
            fail_pending(bridge(app), request_id, client_id, client_tx, msg_id, &err).await;
            None
        }
    }
}

/// Handle requests directly in Rust without involving the webview — today
/// only the `vmark.coherence.*` operations. Returns `Some(response)` if
/// handled, `None` to fall through to the webview.
///
/// Answering in Rust avoids timeouts when the webview is suspended by macOS
/// (App Nap, display sleep).
pub(super) fn handle_rust_side<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
    principal: &BridgePrincipal,
) -> Option<McpResponse> {
    match request.request_type.as_str() {
        // Coherence layer: read-only views plus the one
        // delegated mutating action (`resolve`), answered entirely
        // in Rust from the managed kernel — no webview hop, so they work
        // even when the webview is suspended and need no per-window routing.
        "vmark.coherence.status"
        | "vmark.coherence.edges"
        | "vmark.coherence.claims"
        | "vmark.coherence.contexts"
        | "vmark.coherence.resolve" => {
            let Some(state) = app.try_state::<CoherenceState>() else {
                return Some(McpResponse {
                    success: false,
                    data: None,
                    error: Some("coherence state unavailable".to_string()),
                });
            };
            // External agents may not point the kernel at arbitrary
            // filesystem roots: only workspaces this
            // installation has actually opened are queryable.
            if let Some(root) = request.args.get("workspace_root").and_then(|v| v.as_str()) {
                if !super::coherence_answers::is_known_workspace(app, root) {
                    return Some(McpResponse {
                        success: false,
                        data: None,
                        error: Some(
                            "workspace_root is not a workspace this VMark installation has opened"
                                .to_string(),
                        ),
                    });
                }
            }
            Some(answer_coherence(
                &state,
                &request.request_type,
                &request.args,
                principal,
            ))
        }
        _ => None,
    }
}

pub(super) use super::coherence_answers::answer_coherence;

/// The server's single Rust-terminal entry: coherence requests take the
/// off-loop path below (under an operation lease for a still-connected
/// `client_id`, `McpBridgeState::admit_operation`, taken at the moment it
/// would start, so a stop that drained the client first refuses it and a
/// later stop waits for it). Every other request is answered by the webview:
/// it is refused "Bridge stopped" here when a stop already drained its client,
/// and otherwise falls through (`None`).
pub(super) async fn answer_rust_side<R: Runtime>(
    request: &McpRequest,
    app: &tauri::AppHandle<R>,
    principal: BridgePrincipal,
    client_id: u64,
) -> Option<McpResponse> {
    if request.request_type.starts_with("vmark.coherence.") {
        return Some(
            super::coherence_dispatch::answer_coherence_async(request, app, principal, client_id)
                .await,
        );
    }
    if bridge(app).admit_operation(client_id).await.is_none() {
        return Some(bridge_stopped());
    }
    None
}

/// The answer to an operation a stop got to first.
fn bridge_stopped() -> McpResponse {
    McpResponse {
        success: false,
        data: None,
        error: Some("Bridge stopped".to_string()),
    }
}

#[cfg(test)]
#[path = "routing.test.rs"]
mod tests;
