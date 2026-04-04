//! MCP Bridge WebSocket server loop and connection handling.
//!
//! Manages the TCP listener, WebSocket upgrades, per-client message loops,
//! and request routing to the frontend.

use super::state::{
    cleanup_stale_pending, generate_auth_token, get_bridge_state, get_shutdown_holder,
    get_write_lock, is_read_only_operation, is_webview_alive, remove_port_file,
    set_webview_alive, write_port_file, ClientConnection, PendingRequest,
};
use super::types::{
    ClientIdentity, McpRequest, McpRequestEvent, McpResponse, WsMessage,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

/// Start the MCP bridge WebSocket server.
/// Returns the actual port the server is listening on.
///
/// `on_exit` is called when the server loop terminates (shutdown signal or
/// unexpected exit) so the caller can reset external state like
/// `BRIDGE_RUNNING`.
pub async fn start_bridge(
    app: AppHandle,
    _port: u16,
    on_exit: impl FnOnce() + Send + 'static,
) -> Result<u16, String> {
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

    // Generate auth token and write port:token to file for MCP sidecar discovery
    let auth_token = generate_auth_token();
    write_port_file(&app, actual_port, &auth_token)?;

    log::info!(
        "[MCP Bridge] WebSocket server listening on 127.0.0.1:{} (auth required)",
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
                    log::debug!("[MCP Bridge] Shutdown signal received");
                    break;
                }
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            let app = app_handle.clone();
                            let token = auth_token.clone();
                            tauri::async_runtime::spawn(handle_connection(stream, addr, app, token));
                        }
                        Err(e) => {
                            log::error!("[MCP Bridge] Accept error: {}", e);
                        }
                    }
                }
            }
        }

        // Server loop exited — reset external state so the bridge can be restarted.
        on_exit();
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
/// Requires the client to send an `auth` message with a valid token before
/// any requests are processed.
async fn handle_connection(stream: TcpStream, addr: SocketAddr, app: AppHandle, expected_token: String) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!("[MCP Bridge] WebSocket handshake failed for {}: {}", addr, e);
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

    log::debug!("[MCP Bridge] Client {} connected from {}", client_id, addr);

    // Send welcome notification to client (includes auth_required flag)
    let welcome_msg = WsMessage {
        id: "system".to_string(),
        msg_type: "status".to_string(),
        payload: serde_json::json!({
            "connected": true,
            "clientId": client_id,
            "authRequired": true,
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

    // --- Auth phase: wait for auth message before processing requests ---
    let mut authenticated = false;
    let auth_timeout = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        async {
            while let Some(msg) = ws_receiver.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                            if ws_msg.msg_type == "auth" {
                                let token = ws_msg.payload.get("token")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if token == expected_token {
                                    return Ok(true);
                                } else {
                                    log::warn!("[MCP Bridge] Client {} auth failed: invalid token", client_id);
                                    return Ok(false);
                                }
                            }
                            // Reject any non-auth first message (including identify)
                            log::warn!(
                                "[MCP Bridge] Client {} sent '{}' before auth — rejected",
                                client_id, ws_msg.msg_type
                            );
                        }
                        // Unknown first message — reject
                        return Ok(false);
                    }
                    Ok(Message::Close(_)) => return Err("closed"),
                    Err(_) => return Err("error"),
                    _ => continue,
                }
            }
            Err("stream ended")
        }
    ).await;

    match auth_timeout {
        Ok(Ok(true)) => {
            authenticated = true;
            // Send auth success response
            let auth_ok = WsMessage {
                id: "auth".to_string(),
                msg_type: "auth_result".to_string(),
                payload: serde_json::json!({ "success": true }),
            };
            if let Ok(msg_str) = serde_json::to_string(&auth_ok) {
                let _ = tx.send(msg_str);
            }
            log::debug!("[MCP Bridge] Client {} authenticated", client_id);
        }
        Ok(Ok(false)) => {
            // Auth failed — send error and disconnect
            let auth_fail = WsMessage {
                id: "auth".to_string(),
                msg_type: "auth_result".to_string(),
                payload: serde_json::json!({ "success": false, "error": "Authentication failed" }),
            };
            if let Ok(msg_str) = serde_json::to_string(&auth_fail) {
                let _ = tx.send(msg_str);
            }
            log::warn!("[MCP Bridge] Client {} rejected: auth failed", client_id);
        }
        _ => {
            log::warn!("[MCP Bridge] Client {} auth timeout or error", client_id);
        }
    }

    if !authenticated {
        // Give sender task a moment to flush the auth failure message
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        // Cleanup and disconnect
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.clients.remove(&client_id);
        send_task.abort();
        return;
    }

    // --- Main message loop (authenticated clients only) ---
    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                log::debug!("[MCP Bridge] Client {} closing due to shutdown", client_id);
                break;
            }
            result = ws_receiver.next() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_message(&text, client_id, &app).await {
                            log::error!("[MCP Bridge] Error handling message from client {}: {}", client_id, e);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        log::debug!("[MCP Bridge] Client {} disconnected", client_id);
                        break;
                    }
                    Some(Err(e)) => {
                        log::error!("[MCP Bridge] WebSocket error from client {}: {}", client_id, e);
                        break;
                    }
                    None => {
                        log::debug!("[MCP Bridge] Client {} stream ended", client_id);
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

        let had_id = if let Some(client) = guard.clients.remove(&client_id) {
            let name = client
                .identity
                .as_ref()
                .map(|i| i.display_name())
                .unwrap_or_else(|| format!("Client {}", client_id));
            log::debug!(
                "[MCP Bridge] {} disconnected. Remaining clients: {}",
                name,
                guard.clients.len()
            );
            client.identity.is_some()
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

/// Try to wake the target webview by evaluating a no-op JS snippet.
///
/// When macOS suspends the webview (App Nap, display sleep), emitted events
/// are queued but the frontend JS never executes. Calling the Tauri webview
/// eval API nudges the webview process and can revive the JS event loop.
async fn wake_webview(app: &AppHandle, target_label: &str) {
    if let Some(window) = app.get_webview_window(target_label) {
        log::debug!(
            "[MCP Bridge] Attempting to wake webview '{}' via Tauri eval API",
            target_label
        );
        let _ = window.eval("void(0)");  // no-op to wake suspended webview
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
fn resolve_target_window(args: &serde_json::Value, app: &AppHandle) -> String {
    let window_id = args
        .get("windowId")
        .and_then(|v| v.as_str())
        .unwrap_or("focused");

    if window_id == "focused" {
        // Find the focused document window (main or doc-*)
        app.webview_windows()
            .values()
            .find(|w| {
                let label = w.label();
                w.is_focused().unwrap_or(false)
                    && (label == "main" || label.starts_with("doc-"))
            })
            .map(|w| w.label().to_string())
            .unwrap_or_else(|| "main".to_string())
    } else {
        window_id.to_string()
    }
}

/// Send an error response back to the MCP sidecar client.
fn send_error_response(
    client_tx: &mpsc::UnboundedSender<String>,
    msg_id: &str,
    error: &str,
) {
    let error_response = McpResponse {
        success: false,
        data: None,
        error: Some(error.to_string()),
    };
    let ws_response = WsMessage {
        id: msg_id.to_string(),
        msg_type: "response".to_string(),
        payload: serde_json::to_value(&error_response).unwrap_or_default(),
    };
    if let Ok(json) = serde_json::to_string(&ws_response) {
        let _ = client_tx.send(json);
    }
}

/// Handle an incoming WebSocket message.
async fn handle_message(text: &str, client_id: u64, app: &AppHandle) -> Result<(), String> {
    // Debug: Log raw WebSocket message to trace markdown escaping (dev only — may contain user content)
    #[cfg(debug_assertions)]
    if text.contains("insert") {
        log::debug!("[MCP Bridge DEBUG] Raw WebSocket message: {}", text);
    }

    let msg: WsMessage =
        serde_json::from_str(text).map_err(|e| format!("Invalid message format: {}", e))?;

    // Handle identify message (client sends this after connecting)
    if msg.msg_type == "identify" {
        if let Ok(identity) = serde_json::from_value::<ClientIdentity>(msg.payload) {
            let state = get_bridge_state();
            let mut guard = state.lock().await;

            if let Some(client) = guard.clients.get_mut(&client_id) {
                log::debug!(
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

    // Debug: Log request args to trace markdown escaping issues (dev only — may contain user content)
    #[cfg(debug_assertions)]
    if request.request_type.starts_with("document.insert") || request.request_type == "selection.replace" {
        log::debug!("[MCP Bridge DEBUG] Request type: {}", request.request_type);
        log::debug!("[MCP Bridge DEBUG] Args: {}", serde_json::to_string_pretty(&request.args).unwrap_or_default());
    }

    // Handle requests that Rust can answer directly (no webview needed).
    // This prevents timeouts when the webview is suspended by macOS App Nap.
    if let Some(response) = handle_rust_side(&request, app) {
        let client_tx = {
            let state = get_bridge_state();
            let guard = state.lock().await;
            guard.clients.get(&client_id).map(|c| c.tx.clone())
        };
        let client_tx = client_tx.ok_or("Client not found")?;

        let ws_response = WsMessage {
            id: msg.id,
            msg_type: "response".to_string(),
            payload: serde_json::to_value(&response).unwrap_or_default(),
        };
        let response_json = serde_json::to_string(&ws_response)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        client_tx
            .send(response_json)
            .map_err(|e| format!("Failed to send: {}", e))?;
        return Ok(());
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
        log::debug!(
            "[MCP Bridge] Client {} acquiring write lock for {}",
            client_id, request.request_type
        );
        Some(write_lock.lock().await)
    };

    // Create a oneshot channel for the response
    let (response_tx, response_rx) = oneshot::channel();

    let request_id = msg.id.clone();
    let request_type_for_log = request.request_type.clone();

    // Store the pending request (clean up stale entries first)
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        cleanup_stale_pending(&mut guard);
        guard.pending.insert(
            request_id.clone(),
            PendingRequest {
                response_tx,
                created_at: Instant::now(),
            },
        );
    }

    // Emit event to the target window (not broadcast to all windows).
    // Each window has its own webview with independent editor state, so we
    // must route to the correct one to avoid cross-window content leakage.
    // Serialize args to JSON string to avoid Tauri IPC double-encoding.
    let args_json = serde_json::to_string(&request.args)
        .unwrap_or_else(|_| "{}".to_string());
    let event = McpRequestEvent {
        id: request_id.clone(),
        request_type: request.request_type.clone(),
        args_json,
    };

    let target_label = resolve_target_window(&request.args, app);
    let emit_result = if let Some(window) = app.get_webview_window(&target_label) {
        log::debug!(
            "[MCP Bridge] Emitting mcp-bridge:request to window '{}' for {} (id: {})",
            target_label, request.request_type, request_id
        );
        window.emit("mcp-bridge:request", &event)
    } else {
        // Window not found — clean up and report error
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.remove(&request_id);
        return Err(format!("Target window '{}' not found", target_label));
    };

    if let Err(e) = emit_result {
        // Clean up pending request on emit failure
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.remove(&request_id);
        return Err(format!("Failed to emit event: {}", e));
    }

    // Wait for response with timeout (10 seconds - operations should be fast)
    let response = match tokio::time::timeout(Duration::from_secs(10), response_rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            // Channel closed - clean up and send error to sidecar
            let state = get_bridge_state();
            let mut guard = state.lock().await;
            guard.pending.remove(&request_id);
            drop(guard);

            send_error_response(&client_tx, &msg.id, "Response channel closed");
            return Ok(());
        }
        Err(_) => {
            // First timeout — try to wake the webview and retry once.
            // macOS App Nap or display sleep can suspend JS execution,
            // causing the frontend to miss emitted events.
            let webview_was_alive = is_webview_alive();
            set_webview_alive(false);
            log::warn!(
                "[MCP Bridge] Client {} request {} timed out after 10s (webview_alive={}), attempting wake + retry",
                client_id, request_type_for_log, webview_was_alive
            );

            wake_webview(app, &target_label).await;

            // Create a new oneshot channel for the retry attempt
            let (retry_tx, retry_rx) = oneshot::channel();
            {
                let state = get_bridge_state();
                let mut guard = state.lock().await;
                // Replace the pending request with the new channel
                guard.pending.insert(
                    request_id.clone(),
                    PendingRequest {
                        response_tx: retry_tx,
                        created_at: Instant::now(),
                    },
                );
            }

            // Re-emit the event to the target window (not broadcast)
            if let Some(window) = app.get_webview_window(&target_label) {
                let _ = window.emit("mcp-bridge:request", &event);
            } else {
                log::warn!(
                    "[MCP Bridge] Target window '{}' no longer exists for retry",
                    target_label
                );
            }

            // Wait another 10 seconds for the retry
            match tokio::time::timeout(Duration::from_secs(10), retry_rx).await {
                Ok(Ok(response)) => {
                    log::info!(
                        "[MCP Bridge] Retry succeeded for client {} request {}",
                        client_id, request_type_for_log
                    );
                    response
                }
                Ok(Err(_)) => {
                    // Retry channel closed
                    let state = get_bridge_state();
                    let mut guard = state.lock().await;
                    guard.pending.remove(&request_id);
                    drop(guard);

                    log::warn!(
                        "[MCP Bridge] Client {} request {} retry channel closed",
                        client_id, request_type_for_log
                    );

                    send_error_response(&client_tx, &msg.id, "Response channel closed on retry");
                    return Ok(());
                }
                Err(_) => {
                    // Final timeout after retry — give up
                    let state = get_bridge_state();
                    let mut guard = state.lock().await;
                    guard.pending.remove(&request_id);
                    drop(guard);

                    log::warn!(
                        "[MCP Bridge] Client {} request {} timed out after retry (20s total)",
                        client_id, request_type_for_log
                    );

                    send_error_response(
                        &client_tx,
                        &msg.id,
                        "Request timeout after 20s (including retry with webview wake)",
                    );
                    return Ok(());
                }
            }
        }
    };

    if !is_read {
        log::debug!(
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

/// Handle requests directly in Rust without involving the webview.
/// Returns `Some(response)` if handled, `None` to fall through to webview.
///
/// This avoids timeouts when the webview is suspended by macOS (App Nap,
/// display sleep) for simple window queries that Tauri can answer natively.
fn handle_rust_side(request: &McpRequest, app: &AppHandle) -> Option<McpResponse> {
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
            let focused = app
                .webview_windows()
                .iter()
                .find(|(_, w)| w.is_focused().unwrap_or(false))
                .map(|(label, _)| label.clone());

            Some(McpResponse {
                success: true,
                data: Some(serde_json::Value::String(
                    focused.unwrap_or_else(|| "main".to_string()),
                )),
                error: None,
            })
        }
        _ => None,
    }
}
