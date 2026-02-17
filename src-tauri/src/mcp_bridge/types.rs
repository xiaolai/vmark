//! MCP Bridge type definitions.
//!
//! All message types exchanged between the WebSocket server and MCP sidecars.

use serde::{Deserialize, Serialize};

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
    pub fn from_value(value: serde_json::Value) -> Result<Self, String> {
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
/// Note: args is serialized as a JSON string to avoid Tauri IPC double-encoding issues
/// with nested serde_json::Value. The frontend must parse this string.
#[derive(Clone, Debug, Serialize)]
pub struct McpRequestEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    /// JSON-serialized args string (frontend must JSON.parse this)
    pub args_json: String,
}

/// Response from frontend via command.
#[derive(Clone, Debug, Deserialize)]
pub struct McpResponsePayload {
    pub id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Connected client info exposed to the frontend.
#[derive(Clone, Debug, Serialize)]
pub struct ConnectedClientInfo {
    pub name: String,
    pub version: Option<String>,
}

/// Client identity information sent during handshake.
#[derive(Clone, Debug, Default, serde::Deserialize)]
pub(crate) struct ClientIdentity {
    /// Client name (e.g., "claude-code", "codex-cli", "cursor")
    pub name: String,
    /// Client version
    #[serde(default)]
    pub version: Option<String>,
    /// Process ID
    #[serde(default)]
    #[allow(dead_code)]
    pub pid: Option<u32>,
    /// Parent process name
    #[serde(rename = "parentProcess")]
    #[serde(default)]
    #[allow(dead_code)]
    pub parent_process: Option<String>,
}

impl ClientIdentity {
    /// Get display name for logging (debug only).
    #[cfg(debug_assertions)]
    pub fn display_name(&self) -> String {
        if let Some(ref version) = self.version {
            format!("{} v{}", self.name, version)
        } else {
            self.name.clone()
        }
    }
}
