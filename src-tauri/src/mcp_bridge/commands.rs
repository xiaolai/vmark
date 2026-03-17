//! Tauri commands for the MCP bridge.
//!
//! Provides the `mcp_bridge_respond` command and query helpers
//! used by the frontend and `mcp_server` module.

use super::state::get_bridge_state;
use super::types::{ConnectedClientInfo, McpResponse, McpResponsePayload};

/// Tauri command to send a response from the frontend.
#[tauri::command]
pub async fn mcp_bridge_respond(payload: McpResponsePayload) -> Result<(), String> {
    let state = get_bridge_state();
    let mut guard = state.lock().await;

    #[cfg(debug_assertions)]
    if guard.pending.contains_key(&payload.id) {
        eprintln!("[MCP Bridge] Response received for {}", payload.id);
    } else {
        eprintln!(
            "[MCP Bridge] Response for unknown/expired request {}",
            payload.id
        );
    }

    if let Some(pending) = guard.pending.remove(&payload.id) {
        let response = McpResponse {
            success: payload.success,
            data: payload.data,
            error: payload.error,
        };
        pending
            .response_tx
            .send(response)
            .map_err(|_| "Response channel closed")?;
    }

    Ok(())
}

/// Get count of connected clients.
pub async fn client_count() -> usize {
    let state = get_bridge_state();
    let guard = state.lock().await;
    guard.clients.len()
}

/// Get list of connected clients with their identities.
pub async fn connected_clients() -> Vec<ConnectedClientInfo> {
    let state = get_bridge_state();
    let guard = state.lock().await;
    guard
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
