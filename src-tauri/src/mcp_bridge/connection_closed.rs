//! Telling the webviews that an authenticated MCP connection is gone.
//!
//! The webview keeps per-connection state keyed by the connection id it sees
//! on every request's attribution — the documents each client has read, which
//! become the inputs of that client's next write. Without a close signal that
//! state could only be dropped by guesswork, so every path that removes a
//! client record announces the connection id it held.
//!
//! Key decisions:
//!   - Announced for EVERY connection, identified or not. `clients-changed`
//!     fires only for identified clients (it drives the status display); an
//!     anonymous client that never sent `identify` still has reads to drop.
//!   - Announced by whoever removes the record — the connection's own teardown
//!     or a bridge stop that drains them all — so exactly one announcement per
//!     record: the second remover finds nothing and stays silent.
//!   - Broadcast to all webviews: any window may have served the client.
//!   - The id is the lower-case hyphenated form, the shape the webview's
//!     attribution validator accepts.
//!
//! @coordinates-with mcp_bridge/connection.rs — `unregister_after`, a connection's teardown
//! @coordinates-with mcp_bridge/server.rs — `stop_bridge`, the drain
//! @coordinates-with src/services/mcpBridge/connectionClosed.ts — the webview handler
//! @module mcp_bridge::connection_closed

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// The event a closed connection is announced on.
pub(crate) const CONNECTION_CLOSED_EVENT: &str = "mcp-bridge:connection-closed";

/// Payload of [`CONNECTION_CLOSED_EVENT`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionClosed {
    connection_id: String,
}

impl ConnectionClosed {
    pub(crate) fn new(connection_id: uuid::Uuid) -> Self {
        Self {
            connection_id: connection_id.hyphenated().to_string(),
        }
    }
}

/// Announce that the connection `connection_id` is closed. Best effort: with
/// no webview listening there is no state to drop.
pub(super) fn announce_connection_closed<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: uuid::Uuid,
) {
    if let Err(e) = app.emit(
        CONNECTION_CLOSED_EVENT,
        ConnectionClosed::new(connection_id),
    ) {
        log::warn!("[MCP Bridge] Could not announce a closed connection: {e}");
    }
}

#[cfg(test)]
#[path = "connection_closed.test.rs"]
mod tests;
