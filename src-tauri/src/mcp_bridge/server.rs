//! MCP Bridge WebSocket server loop and connection handling.
//!
//! Manages the TCP listener, WebSocket upgrades, per-client message loops,
//! and request routing to the frontend.

use super::connection::admit_connection;
use super::delivery::{deliver_response, fail_pending, send_error_response};
use super::routing::{
    answer_rust_side, emit_to_window_or_reply, route_target_or_reply, wake_webview,
};
use super::state::{
    connection_principal, generate_auth_token, get_bridge_state, get_shutdown_holder,
    get_write_lock, is_read_only_operation, is_webview_alive, set_webview_alive,
    try_register_pending, PendingRequest,
};
use super::token_file::{remove_port_file, write_port_file};
use super::types::{ClientIdentity, McpRequest, McpRequestEvent, McpResponse, WsMessage};
use std::future::Future;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

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

    // Publish the per-client credentials from the AI clients' own MCP configs
    // (`mcp_config::client_tokens`) so connections can be attributed to the
    // client VMark issued the credential to. Never fatal: an unreadable
    // third-party config is skipped with a log line, and its client simply
    // connects unidentified.
    //
    // Synchronous, and BEFORE the accept loop is spawned, on purpose. It parses
    // up to four config files — `~/.claude.json` can reach tens of MB — so it
    // is not free; deferring it to `spawn_blocking` would let a sidecar that
    // reconnects in the first few hundred milliseconds authenticate against an
    // empty registry and be misidentified as unknown. A bounded startup cost
    // buys "no connection is ever judged against a registry that has not been
    // built yet".
    crate::mcp_config::client_tokens::refresh();

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
                            // Admission (the connection-slot reservation) is
                            // decided HERE, synchronously, before anything is
                            // spawned or cloned — see `admit_connection`.
                            admit_connection(stream, addr, &app_handle, &auth_token);
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

/// Await `deliver` with the global write lock already released.
///
/// Rust drops a guard at the END of its scope — i.e. *after* the delivery
/// await — so the release has to be explicit. It used to only look explicit:
/// the guard was bound as `let _write_guard`, a comment above the final
/// `deliver_response` claimed the lock was already gone, and it was not
/// (audit round 1, finding 8). Delivery can force-disconnect a backpressured
/// peer, which takes the bridge state lock, so every other write operation
/// queued behind one slow client's teardown.
///
/// Taking the guard by value and dropping it before the await makes the
/// ordering a property of this function, and one a test can observe from
/// inside `deliver`.
async fn without_write_lock<T>(
    write_guard: Option<tokio::sync::MutexGuard<'_, ()>>,
    deliver: impl Future<Output = T>,
) -> T {
    drop(write_guard);
    deliver.await
}

/// Handle the `identify` message a client sends after connecting.
///
/// **Informational only.** It sets the label shown in Settings → Integrations
/// and in connect/disconnect logs, and it deliberately does not touch
/// `ClientConnection::principal`: a client may send `identify` at any time and
/// as often as it likes, and it used to be able to name itself into another
/// client's delegations that way (audit 20260728 §2.1).
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
pub(super) async fn handle_message<R: tauri::Runtime>(
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
    // authority binds to the principal the CONNECTION authenticated as, fixed
    // at auth time from the credential VMark issued to that AI client — not to
    // the name the client asserts in `identify`, which it may send and re-send
    // (audit 20260728 §2.1). See `principal.rs`.
    let principal = connection_principal(client_id).await;
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
    let write_guard = if is_read {
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
            fail_pending(
                &request_id,
                client_id,
                &client_tx,
                &msg.id,
                "Response channel closed",
            )
            .await;
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
                    fail_pending(
                        &request_id,
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
                fail_pending(
                    &request_id,
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
                    log::warn!(
                        "[MCP Bridge] Client {} request {} retry channel closed",
                        client_id,
                        request_type_for_log
                    );
                    fail_pending(
                        &request_id,
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
                    log::warn!(
                        "[MCP Bridge] Client {} request {} timed out after retry (20s total)",
                        client_id,
                        request_type_for_log
                    );
                    fail_pending(
                        &request_id,
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

    // Send the response back to the client with the write lock already
    // released — `without_write_lock` drops the guard before it awaits.
    without_write_lock(
        write_guard,
        deliver_response(
            client_id,
            &client_tx,
            msg.id,
            &response,
            "request response could not be enqueued (queue full)",
        ),
    )
    .await?;

    Ok(())
}

#[cfg(test)]
#[path = "server.test.rs"]
mod tests;
