//! Window routing and Rust-side request handling for the MCP bridge.
//!
//! Helpers moved out of `server.rs`: resolving the target webview window for
//! a bridge request, waking a suspended webview, and answering requests that
//! Rust can handle natively without involving the webview.

use super::delivery::send_error_response;
use super::state::get_bridge_state;
use super::types::{McpRequest, McpRequestEvent, McpResponse};
use crate::coherence::commands::CoherenceState;
use tauri::AppHandle;
use tauri::Emitter;
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
            "[MCP Bridge] Attempting to wake webview '{}' via Tauri eval API",
            target_label
        );
        if let Err(e) = window.eval("void(0)") {
            log::debug!(
                "[MCP Bridge] Failed to wake webview '{}': {} (continuing anyway)",
                target_label,
                e
            );
        }
    } else {
        log::warn!(
            "[MCP Bridge] Cannot wake webview — window '{}' not found",
            target_label
        );
    }
}

/// Resolve the target window label from a bridge request's args.
///
/// Extracts the `windowId` field from request args. If `"focused"`, resolves to
/// the currently focused document window. Falls back to `"main"` when no
/// `windowId` is provided or no window has focus.
/// Emit a routed request to its target window. If the window vanished
/// (a close raced the routing snapshot) or the emit failed, clean up the
/// pending entry and reply to the client with the error. Returns `false`
/// when it has already replied — the caller returns.
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
    let outcome = match app.get_webview_window(target_label) {
        Some(window) => {
            log::debug!(
                "[MCP Bridge] Emitting mcp-bridge:request to '{target_label}' for {request_type} (id: {request_id})"
            );
            window
                .emit("mcp-bridge:request", event)
                .map_err(|e| format!("Failed to emit event: {e}"))
        }
        None => Err(format!("Target window '{target_label}' not found")),
    };
    if let Err(err) = outcome {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.remove(request_id);
        drop(guard);
        log::warn!("[MCP Bridge] Client {client_id} request failed: {err}");
        send_error_response(client_id, client_tx, msg_id, &err).await;
        return false;
    }
    true
}

/// F5 (WI-3.5): resolve the target window for a frontend-routed request,
/// snapshotting the window→workspace map. On a routing refusal (ambiguity,
/// conflict, missing pinned window) it removes the pending entry, replies
/// to the client with the error, and returns `None` — the caller returns.
pub(super) async fn route_target_or_reply<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
    request_id: &str,
    client_id: u64,
    client_tx: &Sender<String>,
    msg_id: &str,
) -> Option<String> {
    let window_workspaces = {
        let state = get_bridge_state();
        let guard = state.lock().await;
        guard.window_workspaces.clone()
    };
    match resolve_target_window(&request.args, app, &window_workspaces) {
        Ok(label) => Some(label),
        Err(err) => {
            let state = get_bridge_state();
            let mut guard = state.lock().await;
            guard.pending.remove(request_id);
            drop(guard);
            log::warn!("[MCP Bridge] Client {client_id} routing refused: {err}");
            send_error_response(client_id, client_tx, msg_id, &err).await;
            None
        }
    }
}

pub(super) fn resolve_target_window<R: Runtime>(
    args: &serde_json::Value,
    app: &AppHandle<R>,
    window_workspaces: &std::collections::HashMap<String, String>,
) -> Result<String, String> {
    // An explicit windowId (anything but the "focused" sentinel) is a pin.
    let explicit = args
        .get("windowId")
        .and_then(|v| v.as_str())
        .filter(|w| *w != "focused");
    let path = super::window_routing::scoping_path(args);
    let candidates: Vec<super::window_routing::WindowCandidate> = app
        .webview_windows()
        .values()
        .map(|w| {
            let label = w.label().to_string();
            super::window_routing::WindowCandidate {
                workspace: window_workspaces.get(&label).cloned(),
                focused: w.is_focused().unwrap_or(false),
                is_document: label == "main" || label.starts_with("doc-"),
                label,
            }
        })
        .collect();
    super::window_routing::pick_target_window(explicit, path.as_deref(), &candidates)
}
/// Handle requests directly in Rust without involving the webview.
/// Returns `Some(response)` if handled, `None` to fall through to webview.
///
/// This avoids timeouts when the webview is suspended by macOS (App Nap,
/// display sleep) for simple window queries that Tauri can answer natively.
pub(super) fn handle_rust_side<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
    principal: Option<String>,
) -> Option<McpResponse> {
    match request.request_type.as_str() {
        "windows.list" => {
            let windows: Vec<serde_json::Value> = app
                .webview_windows()
                .iter()
                .filter(|(label, _)| {
                    // Only expose document windows (main, doc-*)
                    *label == "main" || label.starts_with("doc-")
                })
                .map(|(label, window)| {
                    serde_json::json!({
                        "label": label,
                        "title": window.title().unwrap_or_default(),
                        "filePath": null,
                        "isFocused": window.is_focused().unwrap_or(false),
                        "isAiExposed": true,
                    })
                })
                .collect();

            Some(McpResponse {
                success: true,
                data: Some(serde_json::to_value(&windows).unwrap_or_default()),
                error: None,
            })
        }
        "windows.getFocused" => {
            // Only consider document windows (main, doc-*), not settings/utility windows
            let focused = app
                .webview_windows()
                .iter()
                .find(|(label, w)| {
                    w.is_focused().unwrap_or(false)
                        && (*label == "main" || label.starts_with("doc-"))
                })
                .map(|(label, _)| label.clone());

            Some(McpResponse {
                success: true,
                data: Some(match focused {
                    Some(label) => serde_json::Value::String(label),
                    None => serde_json::Value::Null,
                }),
                error: None,
            })
        }
        // Coherence layer (WI-1.10): READ-ONLY status/edges answered entirely
        // in Rust from the managed kernel — no webview hop, so they work even
        // when the webview is suspended and need no per-window routing.
        "vmark.coherence.status"
        | "vmark.coherence.edges"
        | "vmark.coherence.claims"
        | "vmark.coherence.contexts" => {
            let Some(state) = app.try_state::<CoherenceState>() else {
                return Some(McpResponse {
                    success: false,
                    data: None,
                    error: Some("coherence state unavailable".to_string()),
                });
            };
            // External agents may not point the kernel at arbitrary
            // filesystem roots (audit C1): only workspaces this
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
                principal.as_deref(),
            ))
        }
        _ => None,
    }
}

/// Async dispatch for coherence requests (audit C2/C3/C5): `edges` runs
/// scan reconciliation, so it takes the bridge WRITE lock (serializing
/// with document writes) and both actions run on a blocking thread so
/// the WebSocket receive loop keeps serving other clients.
/// The server's single Rust-terminal entry: coherence requests take the
/// off-loop path (write lock for `edges`); everything else stays the
/// synchronous `handle_rust_side` dispatch.
pub(super) use super::coherence_answers::answer_coherence;

pub(super) async fn answer_rust_side<R: Runtime>(
    request: &McpRequest,
    app: &tauri::AppHandle<R>,
    principal: Option<String>,
) -> Option<McpResponse> {
    if request.request_type.starts_with("vmark.coherence.") {
        return Some(answer_coherence_async(request, app, principal).await);
    }
    handle_rust_side(request, app, principal)
}

async fn answer_coherence_async<R: Runtime>(
    request: &McpRequest,
    app: &tauri::AppHandle<R>,
    principal: Option<String>,
) -> McpResponse {
    let write_lock = super::state::get_write_lock();
    // Mutations (resolve) serialize with document writes, like edges.
    let _write_guard = if request.request_type == "vmark.coherence.edges"
        || request.request_type == "vmark.coherence.resolve"
    {
        Some(write_lock.lock().await)
    } else {
        None
    };
    let app_clone = app.clone();
    let request_clone = request.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle_rust_side(&request_clone, &app_clone, principal)
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| McpResponse {
        success: false,
        data: None,
        error: Some("coherence request failed to execute".to_string()),
    })
}

#[cfg(test)]
#[path = "routing.test.rs"]
mod tests;
