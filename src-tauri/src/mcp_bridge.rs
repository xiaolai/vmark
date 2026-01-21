/**
 * MCP Bridge - WebSocket server for AI assistant communication.
 *
 * Provides a WebSocket server that MCP sidecars connect to.
 * Access model:
 * - Read operations: All clients can execute simultaneously
 * - Write operations: Serialized via write lock, released after each write
 */

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};

/// Message format for WebSocket communication with the sidecar.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WsMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: serde_json::Value,
}

/// MCP request from the sidecar.
#[derive(Clone, Debug)]
pub struct McpRequest {
    pub request_type: String,
    pub args: serde_json::Value,
}

impl McpRequest {
    fn from_value(value: serde_json::Value) -> Result<Self, String> {
        let obj = value.as_object().ok_or("Request must be an object")?;

        let request_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or("Request must have a 'type' field")?
            .to_string();

        let mut args = serde_json::Map::new();
        for (key, val) in obj.iter() {
            if key != "type" {
                args.insert(key.clone(), val.clone());
            }
        }

        Ok(McpRequest {
            request_type,
            args: serde_json::Value::Object(args),
        })
    }
}

/// MCP response to send back to the sidecar.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McpResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Event payload sent to frontend.
#[derive(Clone, Debug, Serialize)]
pub struct McpRequestEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    pub args: serde_json::Value,
}

/// Response from frontend via command.
#[derive(Clone, Debug, Deserialize)]
pub struct McpResponsePayload {
    pub id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Client identity information sent during handshake.
#[derive(Clone, Debug, Default, serde::Deserialize)]
struct ClientIdentity {
    /// Client name (e.g., "claude-code", "codex-cli", "cursor")
    name: String,
    /// Client version
    #[serde(default)]
    version: Option<String>,
    /// Process ID
    #[serde(default)]
    #[allow(dead_code)]
    pid: Option<u32>,
    /// Parent process name
    #[serde(rename = "parentProcess")]
    #[serde(default)]
    #[allow(dead_code)]
    parent_process: Option<String>,
}

impl ClientIdentity {
    /// Get display name for logging.
    fn display_name(&self) -> String {
        if let Some(ref version) = self.version {
            format!("{} v{}", self.name, version)
        } else {
            self.name.clone()
        }
    }
}

/// Connected client information.
struct ClientConnection {
    #[allow(dead_code)]
    id: u64,
    #[allow(dead_code)]
    addr: SocketAddr,
    tx: mpsc::UnboundedSender<String>,
    shutdown: Option<oneshot::Sender<()>>,
    #[allow(dead_code)]
    connected_at: Instant,
    /// Client identity (set after identify message)
    identity: Option<ClientIdentity>,
}

/// Bridge state shared across connections.
struct BridgeState {
    /// All connected clients (equal access for reads).
    clients: HashMap<u64, ClientConnection>,
    /// Pending requests waiting for responses from frontend.
    pending: HashMap<String, PendingRequest>,
    /// Counter for generating unique client IDs.
    next_client_id: u64,
}

/// Pending request with client ID for routing response.
struct PendingRequest {
    response_tx: oneshot::Sender<McpResponse>,
    #[allow(dead_code)]
    client_id: u64,
}

/// Global bridge state.
static BRIDGE_STATE: std::sync::OnceLock<Arc<Mutex<BridgeState>>> = std::sync::OnceLock::new();

/// Server shutdown signal.
static SHUTDOWN_TX: std::sync::OnceLock<Arc<RwLock<Option<oneshot::Sender<()>>>>> =
    std::sync::OnceLock::new();

/// Write lock for serializing write operations.
/// All clients can read simultaneously, but writes are serialized.
static WRITE_LOCK: std::sync::OnceLock<Arc<tokio::sync::Mutex<()>>> = std::sync::OnceLock::new();

fn get_bridge_state() -> Arc<Mutex<BridgeState>> {
    BRIDGE_STATE
        .get_or_init(|| {
            Arc::new(Mutex::new(BridgeState {
                clients: HashMap::new(),
                pending: HashMap::new(),
                next_client_id: 1,
            }))
        })
        .clone()
}

fn get_shutdown_holder() -> Arc<RwLock<Option<oneshot::Sender<()>>>> {
    SHUTDOWN_TX
        .get_or_init(|| Arc::new(RwLock::new(None)))
        .clone()
}

fn get_write_lock() -> Arc<tokio::sync::Mutex<()>> {
    WRITE_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Check if an operation is read-only.
fn is_read_only_operation(request_type: &str) -> bool {
    matches!(
        request_type,
        // Document read operations
        "document.getContent"
            | "document.search"
            // Selection/cursor read operations
            | "selection.get"
            | "cursor.getContext"
            // Metadata operations
            | "outline.get"
            | "metadata.get"
            // Window/workspace read operations
            | "windows.list"
            | "windows.getFocused"
            | "workspace.getDocumentInfo"
            // Tab read operations
            | "tabs.list"
            | "tabs.getActive"
            | "tabs.getInfo"
    )
}

/// Start the MCP bridge WebSocket server.
pub async fn start_bridge(app: AppHandle, port: u16) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    #[cfg(debug_assertions)]
    eprintln!("[MCP Bridge] WebSocket server listening on {}", addr);

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
                        Err(e) => {
                            #[cfg(debug_assertions)]
                            eprintln!("[MCP Bridge] Accept error: {}", e);
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

/// Stop the MCP bridge WebSocket server.
pub async fn stop_bridge() {
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
        Err(e) => {
            #[cfg(debug_assertions)]
            eprintln!("[MCP Bridge] WebSocket handshake failed for {}: {}", addr, e);
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
            id: client_id,
            addr,
            tx: tx.clone(),
            shutdown: Some(shutdown_tx),
            connected_at: Instant::now(),
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
                        if let Err(e) = handle_message(&text, client_id, &app).await {
                            #[cfg(debug_assertions)]
                            eprintln!("[MCP Bridge] Error handling message from client {}: {}", client_id, e);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[MCP Bridge] Client {} disconnected", client_id);
                        break;
                    }
                    Some(Err(e)) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[MCP Bridge] WebSocket error from client {}: {}", client_id, e);
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
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;

        if let Some(client) = guard.clients.remove(&client_id) {
            #[cfg(debug_assertions)]
            {
                let name = client
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
        }
    }

    send_task.abort();
}

/// Handle an incoming WebSocket message.
async fn handle_message(text: &str, client_id: u64, app: &AppHandle) -> Result<(), String> {
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
        }
        return Ok(());
    }

    if msg.msg_type != "request" {
        return Ok(());
    }

    let request = McpRequest::from_value(msg.payload.clone())?;
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

    // Store the pending request
    {
        let state = get_bridge_state();
        let mut guard = state.lock().await;
        guard.pending.insert(
            msg.id.clone(),
            PendingRequest {
                response_tx,
                client_id,
            },
        );
    }

    // Emit event to frontend
    let event = McpRequestEvent {
        id: msg.id.clone(),
        request_type: request.request_type.clone(),
        args: request.args,
    };

    app.emit("mcp-bridge:request", &event)
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    // Wait for response with timeout
    let response = tokio::time::timeout(std::time::Duration::from_secs(30), response_rx)
        .await
        .map_err(|_| "Request timeout".to_string())?
        .map_err(|_| "Response channel closed".to_string())?;

    #[cfg(debug_assertions)]
    if !is_read {
        eprintln!(
            "[MCP Bridge] Client {} releasing write lock for {}",
            client_id, request.request_type
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

/// Tauri command to send a response from the frontend.
#[tauri::command]
pub async fn mcp_bridge_respond(payload: McpResponsePayload) -> Result<(), String> {
    let state = get_bridge_state();
    let mut guard = state.lock().await;

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

/// Check if the bridge has any connected clients.
#[allow(dead_code)]
pub async fn is_client_connected() -> bool {
    let state = get_bridge_state();
    let guard = state.lock().await;
    !guard.clients.is_empty()
}

/// Get count of connected clients.
#[allow(dead_code)]
pub async fn client_count() -> usize {
    let state = get_bridge_state();
    let guard = state.lock().await;
    guard.clients.len()
}
