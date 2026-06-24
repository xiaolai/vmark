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
static ACK_ROUTE_TARGETS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn transfer_registry(
) -> std::sync::MutexGuard<'static, Option<HashMap<String, WorkspaceTransferData>>> {
    TRANSFER_REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
}

fn ack_routes() -> std::sync::MutexGuard<'static, Option<HashMap<String, String>>> {
    ACK_ROUTES.lock().unwrap_or_else(|p| p.into_inner())
}

fn ack_route_targets() -> std::sync::MutexGuard<'static, Option<HashMap<String, String>>> {
    ACK_ROUTE_TARGETS.lock().unwrap_or_else(|p| p.into_inner())
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
    ack_route_targets()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data.request_id.clone());

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
    if let Some(targets) = ack_route_targets().as_mut() {
        targets.retain(|_, request_id| request_id != &data.request_id);
    }
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
    let request_id = removed
        .map(|data| data.request_id)
        .or_else(|| {
            ack_route_targets()
                .as_mut()
                .and_then(|targets| targets.remove(window_label))
        });
    if let Some(request_id) = request_id {
        if let Some(routes) = ack_routes().as_mut() {
            routes.remove(&request_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transfer_data(request_id: &str) -> WorkspaceTransferData {
        WorkspaceTransferData {
            request_id: request_id.to_string(),
            operation: "move".to_string(),
            source_window_label: "main".to_string(),
            workspace_instance_id: "wsi-a".to_string(),
            kind: "workspace".to_string(),
            root_id: Some("root-a".to_string()),
            root_path: Some("/repo".to_string()),
            display_name: "repo".to_string(),
            active_tab_id: None,
            tabs: vec![],
        }
    }

    fn reset_transfer_state() {
        *transfer_registry() = None;
        *ack_routes() = None;
        *ack_route_targets() = None;
    }

    #[test]
    fn clear_unclaimed_transfer_clears_ack_route_after_claim() {
        reset_transfer_state();
        let data = transfer_data("req-a");
        transfer_registry()
            .get_or_insert_with(HashMap::new)
            .insert("doc-1".to_string(), data.clone());
        ack_routes()
            .get_or_insert_with(HashMap::new)
            .insert(data.request_id.clone(), data.source_window_label.clone());
        ack_route_targets()
            .get_or_insert_with(HashMap::new)
            .insert("doc-1".to_string(), data.request_id.clone());

        assert!(claim_workspace_transfer("doc-1".to_string()).is_some());
        assert!(ack_routes()
            .as_ref()
            .is_some_and(|routes| routes.contains_key("req-a")));

        clear_unclaimed_transfer("doc-1");

        assert!(!ack_routes()
            .as_ref()
            .is_some_and(|routes| routes.contains_key("req-a")));
        assert!(!ack_route_targets()
            .as_ref()
            .is_some_and(|targets| targets.contains_key("doc-1")));
        reset_transfer_state();
    }
}
