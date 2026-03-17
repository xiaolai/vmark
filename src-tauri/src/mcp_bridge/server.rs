//! MCP Bridge WebSocket server loop and connection handling.
//!
//! Manages the TCP listener, WebSocket upgrades, per-client message loops,
//! and request routing to the frontend.

use super::state::{
    get_bridge_state, get_shutdown_holder, get_write_lock, is_read_only_operation,
    remove_port_file, write_port_file, ClientConnection, PendingRequest,
};
use super::types::{
    ClientIdentity, McpRequest, McpRequestEvent, McpResponse, WsMessage,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

/// Start the MCP bridge WebSocket server.
/// Returns the actual port the server is listening on.
pub async fn start_bridge(app: AppHandle, _port: u16) -> Result<u16, String> {
    // Always bind to port 0 to let OS assign an available port
    // This eliminates port conflicts entirely
    let addr = "127.0.0.1:0";
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    // Get the actual port assigned by the OS
    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    // Write port to file for MCP sidecar discovery
    write_port_file(&app, actual_port)?;

    #[cfg(debug_assertions)]
    eprintln!(
        "[MCP Bridge] WebSocket server listening on 127.0.0.1:{}",
        actual_port
    );

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    {
        let holder = get_shutdown_holder();
        let mut guard = holder.write().await;
        *guard = Some(shutdown_tx);
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    #[cfg(debug_assertions)]
                    eprintln!("[MCP Bridge] Shutdown signal received");
                    break;
                }
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            let app = app_handle.clone();
                            tauri::async_runtime::spawn(handle_connection(stream, addr, app));
                        }
                        Err(_e) => {
                            #[cfg(debug_assertions)]
                            eprintln!("[MCP Bridge] Accept error: {}", _e);
                        }
                    }
                }
            }
        }
    });

    Ok(actual_port)
}

/// Stop the MCP bridge WebSocket server.
pub async fn stop_bridge(app: &AppHandle) {
    // Remove port file so MCP sidecar knows bridge is stopped
    remove_port_file(app);

    // Send shutdown signal to server loop
    let holder = get_shutdown_holder();
    let mut guard = holder.write().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(());
    }
    drop(guard);

    // Close all client connections
    let state = get_bridge_state();
    let mut guard = state.lock().await;

    // Shutdown all clients
    for (_, mut client) in guard.clients.drain() {
        if let Some(shutdown_tx) = client.shutdown.take() {
            let _ = shutdown_tx.send(());
        }
    }

    // Reject all pending requests
    for (_, pending) in guard.pending.drain() {
        let _ = pending.response_tx.send(McpResponse {
            success: false,
            data: None,
            error: Some("Bridge stopped".to_string()),
        });
    }
}

/// Handle a single WebSocket connection.
async fn handle_connection(stream: TcpStream, addr: SocketAddr, app: AppHandle) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(_e) => {
            #[cfg(debug_assertions)]
            eprintln!("[MCP Bridge] WebSocket handshake failed for {}: {}", addr, _e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Create channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Create shutdown channel for this connection
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    // Register client
    let client_id = {
        let state = get_bridge_state();
        let mut guard = state.lock().await;

        let client_id = guard.next_client_id;
        guard.next_client_id += 1;

        let client = ClientConnection {
            tx: tx.clone(),
            shutdown: Some(shutdown_tx),
            identity: None,
        };

        guard.clients.insert(client_id, client);
        client_id
    };

    #[cfg(debug_assertions)]
    eprintln!("[MCP Bridge] Client {} connected from {}", client_id, addr);

    // Send welcome notification to client
    let welcome_msg = WsMessage {
        id: "system".to_string(),
        msg_type: "status".to_string(),
        payload: serde_json::json!({
            "connected": true,
            "clientId": client_id,
        }),
    };
    if let Ok(msg_str) = serde_json::to_string(&welcome_msg) {
        let _ = tx.send(msg_str);
    }

    // Spawn task to forward messages from channel to WebSocket
    let send_task = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                #[cfg(debug_assertions)]
                eprintln!("[MCP Bridge] Client {} closing due to shutdown", client_id);
                break;
            }
            result = ws_receiver.next() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(_e) = handle_message(&text, client_id, &app).await {
                            #[cfg(debug_assertions)]
                            eprintln!("[MCP Bridge] Error handling message from client {}: {}", client_id, _e);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[MCP Bridge] Client {} disconnected", client_id);
                        break;
                    }
                    Some(Err(_e)) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[MCP Bridge] WebSocket error from client {}: {}", client_id, _e);
                        break;
                    }
                    None => {
                        #[cfg(debug_assertions)]
                        eprintln!("[MCP Bridge] Client {} stream ended", client_id);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // Cleanup
    let had_identity = {
        let state = get_bridge_state();
        let mut guard = state.lock().await;

        let had_id = if let Some(_client) = guard.clients.remove(&client_id) {
            #[cfg(debug_assertions)]
            {
                let name = _client
                    .identity
                    .as_ref()
                    .map(|i| i.display_name())
                    .unwrap_or_else(|| format!("Client {}", client_id));
                eprintln!(
                    "[MCP Bridge] {} disconnected. Remaining clients: {}",
                    name,
                    guard.clients.len()
                );
            }
            _client.identity.is_some()
        } else {
            false
        };
        had_id
    };

    // Notify frontend when an identified client disconnects
    if had_identity {
        let _ = app.emit("mcp-bridge:clients-changed", ());
    }

    send_task.abort();
}

/// Handle an incoming WebSocket message.
async fn handle_message(text: &str, client_id: u64, app: &AppHandle) -> Result<(), String> {
    // Debug: Log raw WebSocket message to trace markdown escaping
    #[cfg(debug_assertions)]
    if text.contains("insert") {
        eprintln!("[MCP Bridge DEBUG] Raw WebSocket message: {}", text);
    }

    let msg: WsMessage =
        serde_json::from_str(text).map_err(|e| format!("Invalid message format: {}", e))?;

    // Handle identify message (client sends this after connecting)
    if msg.msg_type == "identify" {
        if let Ok(identity) = serde_json::from_value::<ClientIdentity>(msg.payload) {
            let state = get_bridge_state();
            let mut guard = state.lock().await;

            if let Some(client) = guard.clients.get_mut(&client_id) {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[MCP Bridge] Client {} identified as {}",
                    client_id,
                    identity.display_name()
                );
                client.identity = Some(identity);
            }
            drop(guard);

            // Notify frontend that connected clients changed
            let _ = app.emit("mcp-bridge:clients-changed", ());
        }
        return Ok(());
    }

    if msg.msg_type != "request" {
        return Ok(());
    }

    let request = McpRequest::from_value(msg.payload.clone())?;

    // Debug: Log request args to trace markdown escaping issues
    #[cfg(debug_assertions)]
    if request.request_type.starts_with("document.insert") || request.request_type == "selection.replace" {
        eprintln!("[MCP Bridge DEBUG] Request type: {}", request.request_type);
        eprintln!("[MCP Bridge DEBUG] Args: {}", serde_json::to_string_pretty(&request.args).unwrap_or_default());
    }

    let is_read = is_read_only_operation(&request.request_type);

    // Get client's tx channel
    let client_tx = {
        let state = get_bridge_state();
        let guard = state.lock().await;
        guard.clients.get(&client_id).map(|c| c.tx.clone())
    };

    let client_tx = client_tx.ok_or("Client not found")?;

    // For write operations, acquire the write lock
    // This serializes writes while allowing concurrent reads
    let write_lock = get_write_lock();
    let _write_guard = if is_read {
        None
    } else {
        #[cfg(debug_assertions)]
        eprintln!(
            "[MCP Bridge] Client {} acquiring write lock for {}",
            client_id, request.request_type
        );
        Some(write_lock.lock().await)
    };

    // Create a oneshot channel for the response
    let (response_tx, response_rx) = oneshot::channel();

    let request_id = msg.id.clone();
    #[cfg(debug_assertions)]
    let request_type_for_log = request.request_type.clone();

    // Store the pending request
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.insert(
            request_id.clone(),
            PendingRequest {
                response_tx,
            },
        );
    }

    // Emit event to frontend
    // Serialize args to JSON string to avoid Tauri IPC double-encoding
    let args_json = serde_json::to_string(&request.args)
        .unwrap_or_else(|_| "{}".to_string());
    let event = McpRequestEvent {
        id: request_id.clone(),
        request_type: request.request_type.clone(),
        args_json,
    };

    if let Err(e) = app.emit("mcp-bridge:request", &event) {
        // Clean up pending request on emit failure
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.remove(&request_id);
        return Err(format!("Failed to emit event: {}", e));
    }

    #[cfg(debug_assertions)]
    eprintln!(
        "[MCP Bridge] Emitted mcp-bridge:request for {} (id: {})",
        request.request_type, request_id
    );

    // Wait for response with timeout (10 seconds - operations should be fast)
    let response = match tokio::time::timeout(std::time::Duration::from_secs(10), response_rx).await
    {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            // Channel closed - clean up and send error to sidecar
            let state = get_bridge_state();
            let mut guard = state.lock().await;
            guard.pending.remove(&request_id);
            drop(guard);

            let error_response = McpResponse {
                success: false,
                data: None,
                error: Some("Response channel closed".to_string()),
            };
            let ws_response = WsMessage {
                id: msg.id.clone(),
                msg_type: "response".to_string(),
                payload: serde_json::to_value(&error_response).unwrap_or_default(),
            };
            if let Ok(json) = serde_json::to_string(&ws_response) {
                let _ = client_tx.send(json);
            }
            return Ok(());
        }
        Err(_) => {
            // Timeout - clean up and send error to sidecar
            let state = get_bridge_state();
            let mut guard = state.lock().await;
            guard.pending.remove(&request_id);
            drop(guard);

            #[cfg(debug_assertions)]
            eprintln!(
                "[MCP Bridge] Client {} request {} timed out after 10s",
                client_id, request_type_for_log
            );

            let error_response = McpResponse {
                success: false,
                data: None,
                error: Some("Request timeout after 10s".to_string()),
            };
            let ws_response = WsMessage {
                id: msg.id.clone(),
                msg_type: "response".to_string(),
                payload: serde_json::to_value(&error_response).unwrap_or_default(),
            };
            if let Ok(json) = serde_json::to_string(&ws_response) {
                let _ = client_tx.send(json);
            }
            return Ok(());
        }
    };

    #[cfg(debug_assertions)]
    if !is_read {
        eprintln!(
            "[MCP Bridge] Client {} completed {} - releasing write lock",
            client_id, request_type_for_log
        );
    }

    // Write lock is automatically released here when _write_guard is dropped

    // Send response back to client
    let ws_response = WsMessage {
        id: msg.id,
        msg_type: "response".to_string(),
        payload: serde_json::to_value(&response).unwrap_or_default(),
    };

    let response_json =
        serde_json::to_string(&ws_response).map_err(|e| format!("Failed to serialize: {}", e))?;

    client_tx
        .send(response_json)
        .map_err(|e| format!("Failed to send response: {}", e))?;

    Ok(())
}
