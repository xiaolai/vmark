//! Per-client WebSocket message loop (split from connection.rs).

use super::server::handle_message;
use futures_util::StreamExt;
use tauri::AppHandle;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::protocol::Message;

/// Pump authenticated frames until the peer or the bridge closes.
pub(super) async fn run_message_loop<S, R: tauri::Runtime>(
    ws_receiver: &mut S,
    shutdown_rx: &mut oneshot::Receiver<()>,
    client_id: u64,
    app: &AppHandle<R>,
) where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        tokio::select! {
            _ = &mut *shutdown_rx => {
                log::debug!("[MCP Bridge] Client {client_id} closing due to shutdown");
                return;
            }
            result = ws_receiver.next() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_message(&text, client_id, app).await {
                            log::error!("[MCP Bridge] Error handling message from client {client_id}: {e}");
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        log::debug!("[MCP Bridge] Client {client_id} disconnected");
                        return;
                    }
                    Some(Err(e)) => {
                        log::error!("[MCP Bridge] WebSocket error from client {client_id}: {e}");
                        return;
                    }
                    None => {
                        log::debug!("[MCP Bridge] Client {client_id} stream ended");
                        return;
                    }
                    _ => {}
                }
            }
        }
    }
}
