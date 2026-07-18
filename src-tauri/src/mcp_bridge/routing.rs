//! Window routing and Rust-side request handling for the MCP bridge.
//!
//! Helpers moved out of `server.rs`: resolving the target webview window for
//! a bridge request, waking a suspended webview, and answering requests that
//! Rust can handle natively without involving the webview.

use super::types::{McpRequest, McpResponse};
use crate::coherence::commands::{perform_breakdown, perform_status, CoherenceState};
use tauri::AppHandle;
use tauri::Manager;
use tauri::Runtime;

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
pub(super) fn resolve_target_window<R: Runtime>(
    args: &serde_json::Value,
    app: &AppHandle<R>,
) -> String {
    let window_id = args
        .get("windowId")
        .and_then(|v| v.as_str())
        .unwrap_or("focused");

    if window_id == "focused" {
        // Find the focused document window (main or doc-*)
        let resolved = app
            .webview_windows()
            .values()
            .find(|w| {
                let label = w.label();
                w.is_focused().unwrap_or(false) && (label == "main" || label.starts_with("doc-"))
            })
            .map(|w| w.label().to_string());

        if resolved.is_none() {
            log::warn!(
                "[MCP Bridge] No focused document window found — falling back to 'main'. \
                 Non-document window may have focus, or app may be in background."
            );
        }
        resolved.unwrap_or_else(|| "main".to_string())
    } else {
        window_id.to_string()
    }
}

/// Handle requests directly in Rust without involving the webview.
/// Returns `Some(response)` if handled, `None` to fall through to webview.
///
/// This avoids timeouts when the webview is suspended by macOS (App Nap,
/// display sleep) for simple window queries that Tauri can answer natively.
pub(super) fn handle_rust_side<R: Runtime>(
    request: &McpRequest,
    app: &AppHandle<R>,
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
        "vmark.coherence.status" | "vmark.coherence.edges" => {
            let Some(state) = app.try_state::<CoherenceState>() else {
                return Some(McpResponse {
                    success: false,
                    data: None,
                    error: Some("coherence state unavailable".to_string()),
                });
            };
            Some(answer_coherence(
                &state,
                &request.request_type,
                &request.args,
            ))
        }
        _ => None,
    }
}

/// Answer a `vmark.coherence.*` read request from the managed kernel state.
///
/// Factored out of `handle_rust_side` so it can be tested without a mock
/// Tauri app. Never panics: every failure (missing/invalid workspace_root,
/// kernel open failure, poisoned lock) becomes `success: false` with the
/// error string.
pub(super) fn answer_coherence(
    state: &CoherenceState,
    request_type: &str,
    args: &serde_json::Value,
) -> McpResponse {
    match answer_coherence_inner(state, request_type, args) {
        Ok(data) => McpResponse {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(e) => McpResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

fn answer_coherence_inner(
    state: &CoherenceState,
    request_type: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let root = args.get("workspace_root").and_then(|v| v.as_str()).ok_or(
        "workspace_root (string) is required — the absolute path of the workspace to query",
    )?;
    let root = std::path::Path::new(root);
    if !root.is_dir() {
        return Err(format!(
            "workspace_root is not an accessible directory: {}",
            root.display()
        ));
    }
    let kernel = state.registry.kernel_for(root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    match request_type {
        "vmark.coherence.status" => {
            let status = perform_status(&mut kernel)?;
            serde_json::to_value(status).map_err(|e| format!("serialize status: {e}"))
        }
        "vmark.coherence.edges" => {
            let rows = perform_breakdown(&mut kernel)?;
            serde_json::to_value(rows).map_err(|e| format!("serialize edges: {e}"))
        }
        other => Err(format!("unknown coherence request type: {other}")),
    }
}

#[cfg(test)]
#[path = "routing.test.rs"]
mod tests;
