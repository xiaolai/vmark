//! Tauri commands for the MCP bridge.
//!
//! Provides the `mcp_bridge_respond` command and query helpers
//! used by the frontend and the `control` module.

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
        log::debug!(
            "[MCP Bridge] Response received for {}",
            crate::peer_text::peer_text(&payload.id)
        );
    } else {
        log::debug!(
            "[MCP Bridge] Response for unknown/expired request {}",
            crate::peer_text::peer_text(&payload.id)
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

/// F5: register (or clear) the calling window's open-workspace root
/// so the router can send workspace-scoped requests to the owning window. The
/// frontend calls this on workspace open (Some) and close (None). The window
/// is the caller, never a label: one window could otherwise claim another's
/// workspace and receive the MCP requests meant for it.
#[tauri::command]
pub async fn mcp_bridge_set_window_workspace<R: tauri::Runtime>(
    window: tauri::Window<R>,
    bridge: State<'_, McpBridgeState>,
    workspace_root: Option<String>,
) -> Result<(), CommandError> {
    let window_label = window.label().to_string();
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

/// The most tabs one window may publish; a longer list is refused, not stored.
pub const MAX_WINDOW_TABS: usize = 10_000;
/// The longest tab id accepted (ids are `tab-<uuid>`).
const MAX_TAB_ID_BYTES: usize = 128;

/// Publish the calling window's tab ids so a request naming a tab routes to
/// the window that holds it (each webview holds only its own tabs). The window
/// is the caller, never a label: one window could otherwise claim another's
/// tabs and receive the requests meant for them. Replaces the window's list;
/// an empty one clears it.
#[tauri::command]
pub async fn mcp_bridge_set_window_tabs<R: tauri::Runtime>(
    window: tauri::Window<R>,
    bridge: State<'_, McpBridgeState>,
    tab_ids: Vec<String>,
) -> Result<(), CommandError> {
    if tab_ids.len() > MAX_WINDOW_TABS {
        return Err(CommandError::invalid_input(format!(
            "a window may publish at most {MAX_WINDOW_TABS} tabs, got {}",
            tab_ids.len()
        )));
    }
    if tab_ids
        .iter()
        .any(|id| id.is_empty() || id.len() > MAX_TAB_ID_BYTES)
    {
        return Err(CommandError::invalid_input(format!(
            "a tab id must be 1 to {MAX_TAB_ID_BYTES} bytes"
        )));
    }
    bridge.set_window_tabs(window.label(), tab_ids).await;
    Ok(())
}
