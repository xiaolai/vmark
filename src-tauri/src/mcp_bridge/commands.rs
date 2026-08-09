//! Tauri commands for the MCP bridge.
//!
//! Provides the `mcp_bridge_respond` command and query helpers
//! used by the frontend and `mcp_server` module.

use super::managed::McpBridgeState;
use super::types::{ConnectedClientInfo, McpResponse, McpResponsePayload};
use crate::command_error::CommandError;
use tauri::State;

/// Tauri command to send a response from the frontend.
#[tauri::command]
pub async fn mcp_bridge_respond(
    bridge: State<'_, McpBridgeState>,
    payload: McpResponsePayload,
) -> Result<(), CommandError> {
    let mut guard = bridge.lock().await;

    let response = McpResponse {
        success: payload.success,
        data: payload.data,
        error: payload.error,
    };
    // The only error `resolve_pending` returns is a CLOSED response channel,
    // i.e. the MCP request that was waiting has already timed out or been
    // cancelled and dropped its receiver. Nothing is broken and nothing the
    // caller sent was wrong — the waiter simply left. `conflict`, not
    // `internal`. An unknown/expired id is not an error at all (`false`).
    let delivered = super::state::resolve_pending(&mut guard, &payload.id, response)
        .map_err(CommandError::conflict)?;
    if delivered {
        log::debug!("[MCP Bridge] Response received for {}", payload.id);
    } else {
        log::debug!(
            "[MCP Bridge] Response for unknown/expired request {}",
            payload.id
        );
    }

    Ok(())
}

/// Tauri command to receive a heartbeat from the frontend webview.
/// Called periodically to confirm the webview is alive and responsive.
#[tauri::command]
pub async fn mcp_bridge_heartbeat(bridge: State<'_, McpBridgeState>) -> Result<(), CommandError> {
    bridge.set_webview_alive(true);
    Ok(())
}

/// Get count of connected clients.
pub async fn client_count(bridge: &McpBridgeState) -> usize {
    bridge.lock().await.clients.len()
}

/// Get list of connected clients with their identities.
pub async fn connected_clients(bridge: &McpBridgeState) -> Vec<ConnectedClientInfo> {
    bridge
        .lock()
        .await
        .clients
        .values()
        .filter_map(|c| {
            c.identity.as_ref().map(|i| ConnectedClientInfo {
                name: i.name.clone(),
                version: i.version.clone(),
            })
        })
        .collect()
}

/// F5 (WI-3.5): register (or clear) a window's open-workspace root so the
/// router can send workspace-scoped requests to the owning window. The
/// frontend calls this on workspace open (Some) and close (None).
#[tauri::command]
pub async fn mcp_bridge_set_window_workspace(
    bridge: State<'_, McpBridgeState>,
    window_label: String,
    workspace_root: Option<String>,
) -> Result<(), CommandError> {
    let mut guard = bridge.lock().await;
    match workspace_root {
        Some(root) => {
            guard.window_workspaces.insert(window_label, root);
        }
        None => {
            guard.window_workspaces.remove(&window_label);
        }
    }
    Ok(())
}
