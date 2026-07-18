//! MCP Bridge WebSocket server loop and connection handling.
//!
//! Manages the TCP listener, WebSocket upgrades, per-client message loops,
//! and request routing to the frontend.

use super::delivery::{deliver_response, enqueue_client_msg, send_error_response};
use super::routing::{
    answer_rust_side, emit_to_window_or_reply, route_target_or_reply, wake_webview,
};
use super::state::{
    authenticated_principal, generate_auth_token, get_bridge_state, get_shutdown_holder,
    get_write_lock, is_read_only_operation, is_webview_alive, remove_port_file, set_webview_alive,
    try_register_pending, write_port_file, ClientConnection, PendingRequest, CLIENT_TX_CAPACITY,
};
use super::types::{ClientIdentity, McpRequest, McpRequestEvent, McpResponse, WsMessage};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

/// Monotonic counter behind `next_bridge_request_id`.
static NEXT_REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Mint a bridge-internal request id.
///
/// Pending requests — and the events emitted to the frontend, which echoes
/// the event id back via `mcp_bridge_respond` — are keyed by this id rather
/// than the client-supplied message id: two connected sidecars generate their
/// message ids independently and can collide, and a collision in the pending
/// map would silently drop one client's response channel and route its
/// response to the other. The client's own message id is only used when
/// writing the WebSocket response back to that client.
fn next_bridge_request_id() -> String {
    format!(
        "bridge-{}",
        NEXT_REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

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

    crate::task::spawn_logged("mcp-bridge-accept-loop", async move {
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
                            crate::task::spawn_logged(
                                "mcp-bridge-connection",
                                handle_connection(stream, addr, app, token),
                            );
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
async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    app: AppHandle,
    expected_token: String,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!(
                "[MCP Bridge] WebSocket handshake failed for {}: {}",
                addr,
                e
            );
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Create channel for sending messages to this client.
    // Bounded so a stalled client cannot exhaust process memory; senders
    // use `try_send` and drop+log on overflow rather than blocking.
    let (tx, mut rx) = mpsc::channel::<String>(CLIENT_TX_CAPACITY);

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
        enqueue_client_msg(client_id, &tx, msg_str);
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
    let auth_timeout = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                        if ws_msg.msg_type == "auth" {
                            let token = ws_msg
                                .payload
                                .get("token")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if token == expected_token {
                                return Ok(true);
                            } else {
                                log::warn!(
                                    "[MCP Bridge] Client {} auth failed: invalid token",
                                    client_id
                                );
                                return Ok(false);
                            }
                        }
                        // Reject any non-auth first message (including identify)
                        log::warn!(
                            "[MCP Bridge] Client {} sent '{}' before auth — rejected",
                            client_id,
                            ws_msg.msg_type
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
    })
    .await;

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
                enqueue_client_msg(client_id, &tx, msg_str);
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
                enqueue_client_msg(client_id, &tx, msg_str);
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

    // Cleanup. F6 (WI-3.5, D4.2): disconnect removes ONLY the client record
    // — never tabs, never a window's workspace (disconnect_preserves_* test).
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

/// Handle the `identify` message a client sends after connecting.
async fn handle_identify<R: tauri::Runtime>(
    payload: serde_json::Value,
    client_id: u64,
    app: &AppHandle<R>,
) {
    if let Ok(identity) = serde_json::from_value::<ClientIdentity>(payload) {
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
}

/// Parse the MCP payload of a `request` envelope.
///
/// The envelope itself parsed fine, so the client message id is known — on a
/// malformed payload, answer the client with the parse error instead of
/// bubbling it up to the log-only message loop, which would leave the client
/// hanging until its own timeout (Codex audit 20260718).
async fn parse_request_or_reply(
    msg_id: &str,
    payload: serde_json::Value,
    client_id: u64,
    client_tx: &mpsc::Sender<String>,
) -> Option<McpRequest> {
    match McpRequest::from_value(payload) {
        Ok(request) => Some(request),
        Err(e) => {
            log::warn!(
                "[MCP Bridge] Client {} sent request with invalid payload: {}",
                client_id,
                e
            );
            send_error_response(client_id, client_tx, msg_id, &e).await;
            None
        }
    }
}

/// Handle an incoming WebSocket message.
///
/// Generic over the Tauri runtime so tests can drive the full path with
/// `tauri::test::MockRuntime`; production callers pass the default runtime.
async fn handle_message<R: tauri::Runtime>(
    text: &str,
    client_id: u64,
    app: &AppHandle<R>,
) -> Result<(), String> {
    // Debug: Log raw WebSocket message to trace markdown escaping (dev only — may contain user content)
    #[cfg(debug_assertions)]
    if text.contains("insert") {
        log::debug!("[MCP Bridge DEBUG] Raw WebSocket message: {}", text);
    }

    let msg: WsMessage =
        serde_json::from_str(text).map_err(|e| format!("Invalid message format: {}", e))?;

    // Handle identify message (client sends this after connecting)
    if msg.msg_type == "identify" {
        handle_identify(msg.payload, client_id, app).await;
        return Ok(());
    }

    if msg.msg_type != "request" {
        return Ok(());
    }

    // Fetch the client's tx channel up front — every later step (payload
    // parse failure, rust-side answer, overload, unknown window, response)
    // needs it to answer the client.
    let client_tx = {
        let state = get_bridge_state();
        let guard = state.lock().await;
        guard.clients.get(&client_id).map(|c| c.tx.clone())
    };
    let client_tx = client_tx.ok_or("Client not found")?;

    let Some(request) = parse_request_or_reply(&msg.id, msg.payload, client_id, &client_tx).await
    else {
        return Ok(());
    };

    // Debug: Log request args to trace markdown escaping issues (dev only — may contain user content)
    #[cfg(debug_assertions)]
    if request.request_type.starts_with("document.insert")
        || request.request_type == "selection.replace"
    {
        log::debug!("[MCP Bridge DEBUG] Request type: {}", request.request_type);
        log::debug!(
            "[MCP Bridge DEBUG] Args: {}",
            serde_json::to_string_pretty(&request.args).unwrap_or_default()
        );
    }

    // Handle requests Rust answers directly (no webview) — incl. coherence
    // off-loop with the write lock (WI-1.10). WI-3.5 (D2.3): delegated
    // authority binds only to the client's AUTHENTICATED identity.
    let principal = authenticated_principal(client_id).await;
    if let Some(response) = answer_rust_side(&request, app, principal).await {
        deliver_response(
            client_id,
            &client_tx,
            msg.id,
            &response,
            "rust-side response could not be enqueued (queue full)",
        )
        .await?;
        return Ok(());
    }

    let is_read = is_read_only_operation(&request.request_type);

    // For write operations, acquire the write lock
    // This serializes writes while allowing concurrent reads
    let write_lock = get_write_lock();
    let _write_guard = if is_read {
        None
    } else {
        log::debug!(
            "[MCP Bridge] Client {} acquiring write lock for {}",
            client_id,
            request.request_type
        );
        Some(write_lock.lock().await)
    };

    // Create a oneshot channel for the response
    let (response_tx, response_rx) = oneshot::channel();

    let request_id = next_bridge_request_id();
    let request_type_for_log = request.request_type.clone();

    // Store the pending request (sweeps stale entries, enforces the
    // overload cap). The state lock is released before responding —
    // send_error_response may force-disconnect, which re-locks it.
    let registered = {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        try_register_pending(&mut guard, request_id.clone(), response_tx)
    };
    if let Err(err) = registered {
        log::warn!(
            "[MCP Bridge] Client {} request rejected: {}",
            client_id,
            err
        );
        // Answer the client instead of silently dropping the request —
        // otherwise it hangs until its own timeout.
        send_error_response(client_id, &client_tx, &msg.id, &err).await;
        return Ok(());
    }

    // Emit event to the target window (not broadcast to all windows).
    // Each window has its own webview with independent editor state, so we
    // must route to the correct one to avoid cross-window content leakage.
    // Serialize args to JSON string to avoid Tauri IPC double-encoding.
    let args_json = serde_json::to_string(&request.args).unwrap_or_else(|_| "{}".to_string());
    let event = McpRequestEvent {
        id: request_id.clone(),
        request_type: request.request_type.clone(),
        args_json,
    };

    // F5 (WI-3.5): route by owning workspace, fail loud on ambiguity /
    // conflict / missing window (helper replies + cleans up on refusal).
    let Some(target_label) =
        route_target_or_reply(&request, app, &request_id, client_id, &client_tx, &msg.id).await
    else {
        return Ok(());
    };
    // Emit to the target window; helper replies + cleans up if the window
    // vanished (TOCTOU) or the emit failed, returning false to stop here.
    if !emit_to_window_or_reply(
        app,
        &target_label,
        &event,
        &request.request_type,
        &request_id,
        client_id,
        &client_tx,
        &msg.id,
    )
    .await
    {
        return Ok(());
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

            send_error_response(client_id, &client_tx, &msg.id, "Response channel closed").await;
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

            // Install the retry channel BEFORE waking: once the webview
            // resumes, the QUEUED original event may execute immediately and
            // its response must land in this channel rather than the
            // already-abandoned first oneshot — otherwise a successful wake
            // recovery turns into a client timeout (cross-model review,
            // audit 20260612 remediation).
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

            wake_webview(app, &target_label).await;

            // Re-emit the event to the target window (not broadcast)
            if let Some(window) = app.get_webview_window(&target_label) {
                if let Err(e) = window.emit("mcp-bridge:request", &event) {
                    log::warn!(
                        "[MCP Bridge] Retry emit to window '{}' failed: {}",
                        target_label,
                        e
                    );
                    let state = get_bridge_state();
                    let mut guard = state.lock().await;
                    guard.pending.remove(&request_id);
                    drop(guard);
                    send_error_response(
                        client_id,
                        &client_tx,
                        &msg.id,
                        &format!(
                            "Failed to re-emit to window '{}' on retry: {}",
                            target_label, e
                        ),
                    )
                    .await;
                    return Ok(());
                }
            } else {
                log::warn!(
                    "[MCP Bridge] Target window '{}' no longer exists for retry",
                    target_label
                );
                let state = get_bridge_state();
                let mut guard = state.lock().await;
                guard.pending.remove(&request_id);
                drop(guard);
                send_error_response(
                    client_id,
                    &client_tx,
                    &msg.id,
                    &format!("Target window '{}' was closed during retry", target_label),
                )
                .await;
                return Ok(());
            }

            // Wait another 10 seconds for the retry
            match tokio::time::timeout(Duration::from_secs(10), retry_rx).await {
                Ok(Ok(response)) => {
                    log::info!(
                        "[MCP Bridge] Retry succeeded for client {} request {}",
                        client_id,
                        request_type_for_log
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
                        client_id,
                        request_type_for_log
                    );

                    send_error_response(
                        client_id,
                        &client_tx,
                        &msg.id,
                        "Response channel closed on retry",
                    )
                    .await;
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
                        client_id,
                        request_type_for_log
                    );

                    send_error_response(
                        client_id,
                        &client_tx,
                        &msg.id,
                        "Request timeout after 20s (including retry with webview wake)",
                    )
                    .await;
                    return Ok(());
                }
            }
        }
    };

    if !is_read {
        log::debug!(
            "[MCP Bridge] Client {} completed {} - releasing write lock",
            client_id,
            request_type_for_log
        );
    }

    // Write lock is automatically released here when _write_guard is dropped

    // Send response back to client
    deliver_response(
        client_id,
        &client_tx,
        msg.id,
        &response,
        "request response could not be enqueued (queue full)",
    )
    .await?;

    Ok(())
}

#[cfg(test)]
#[path = "server.test.rs"]
mod tests;
