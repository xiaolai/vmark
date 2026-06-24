//! # Workspace Transfer
//!
//! Moves or duplicates workspace-instance payloads through a Rust-side registry.
//! The source keeps its state until the target window applies the payload and
//! sends an ack, so failed target startup does not delete the source instance.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::window_manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferTabData {
    pub tab_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub content: String,
    pub saved_content: String,
    pub is_dirty: bool,
    pub read_only: bool,
    pub is_pinned: bool,
    pub format_id: String,
    pub editing_enabled: Option<bool>,
    pub active_schema_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferData {
    pub request_id: String,
    pub operation: String,
    pub source_window_label: String,
    pub workspace_instance_id: String,
    pub kind: String,
    pub root_id: Option<String>,
    pub root_path: Option<String>,
    pub display_name: String,
    pub active_tab_id: Option<String>,
    pub tabs: Vec<WorkspaceTransferTabData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferAck {
    pub request_id: String,
    pub target_window_label: String,
    pub workspace_instance_id: String,
}

static TRANSFER_REGISTRY: Mutex<Option<HashMap<String, WorkspaceTransferData>>> = Mutex::new(None);
static ACK_ROUTES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn transfer_registry(
) -> std::sync::MutexGuard<'static, Option<HashMap<String, WorkspaceTransferData>>> {
    TRANSFER_REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
}

fn ack_routes() -> std::sync::MutexGuard<'static, Option<HashMap<String, String>>> {
    ACK_ROUTES.lock().unwrap_or_else(|p| p.into_inner())
}

#[tauri::command]
pub fn detach_workspace_to_new_window(
    app: AppHandle,
    data: WorkspaceTransferData,
) -> Result<String, String> {
    let label = window_manager::create_document_window_with_url(
        &app,
        "/?workspaceTransfer=true".to_string(),
    )
    .map_err(|e| e.to_string())?;

    transfer_registry()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data.clone());
    ack_routes()
        .get_or_insert_with(HashMap::new)
        .insert(data.request_id.clone(), data.source_window_label.clone());

    Ok(label)
}

#[tauri::command]
pub fn claim_workspace_transfer(window_label: String) -> Option<WorkspaceTransferData> {
    transfer_registry()
        .as_mut()
        .and_then(|map| map.remove(&window_label))
}

#[tauri::command]
pub fn ack_workspace_transfer(app: AppHandle, data: WorkspaceTransferAck) -> Result<(), String> {
    let source = ack_routes()
        .as_mut()
        .and_then(|map| map.remove(&data.request_id));
    let Some(source_window_label) = source else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(&source_window_label) else {
        return Ok(());
    };
    window
        .emit("workspace:transfer-ack", data)
        .map_err(|e| e.to_string())
}

pub fn clear_unclaimed_transfer(window_label: &str) {
    let removed = transfer_registry()
        .as_mut()
        .and_then(|map| map.remove(window_label));
    if let Some(data) = removed {
        if let Some(routes) = ack_routes().as_mut() {
            routes.remove(&data.request_id);
        }
    }
}
