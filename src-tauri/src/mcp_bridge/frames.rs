//! Frames written to a bridge socket before the peer has a queue (WI-9).
//!
//! During the auth phase there is no per-client mpsc channel and no writer
//! task, so `connection.rs` writes straight to the split sink. These are the
//! only things the server ever says to an unauthenticated peer.
//!
//! Split out of `handshake.rs`, which keeps the pre-auth *policy* (origin
//! allowlist, size caps, connection cap, token comparison, auth state
//! machine); this file is just the wire shapes.

use super::types::WsMessage;
use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::Message;

/// The outbound half of a split bridge socket, used directly during the auth
/// phase — before the client has a per-connection queue to write through.
pub(super) type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>;

/// The pre-auth welcome notification, byte-identical to the historical
/// payload. The sidecar ignores `status` frames entirely, but a client that
/// *waited* for one before sending its token would deadlock if this moved
/// after auth, so it stays pre-auth. It costs one small write — the expensive
/// parts (the 1024-slot queue, the `clients` entry) are what moved behind
/// authentication.
pub(super) fn welcome_frame(client_id: u64) -> WsMessage {
    WsMessage {
        id: "system".to_string(),
        msg_type: "status".to_string(),
        payload: serde_json::json!({
            "connected": true,
            "clientId": client_id,
            "authRequired": true,
        }),
    }
}

/// The `auth_result` the peer waits on before it considers itself connected.
pub(super) fn auth_result_frame(success: bool) -> WsMessage {
    let payload = if success {
        serde_json::json!({ "success": true })
    } else {
        serde_json::json!({ "success": false, "error": "Authentication failed" })
    };
    WsMessage {
        id: "auth".to_string(),
        msg_type: "auth_result".to_string(),
        payload,
    }
}

/// Serialize and write a frame straight to the socket, bypassing the
/// per-client queue (which does not exist yet during the auth phase).
/// Returns `false` when the write failed — the caller closes the socket.
pub(super) async fn send_frame(sink: &mut WsSink, msg: &WsMessage) -> bool {
    let Ok(json) = serde_json::to_string(msg) else {
        log::error!("[MCP Bridge] Failed to serialize handshake frame");
        return false;
    };
    sink.send(Message::Text(json.into())).await.is_ok()
}

#[cfg(test)]
#[path = "frames.test.rs"]
mod tests;
