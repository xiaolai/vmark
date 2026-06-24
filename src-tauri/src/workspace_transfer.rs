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

/// Routing data needed to validate and deliver a transfer ack.
///
/// We store the expected target window label and workspace-instance id so an
/// ack carrying a wrong or stale `target_window_label` / `workspace_instance_id`
/// can be rejected before we tear down the route or notify the source — a
/// mismatched ack must not remove the route or fire a spurious source ack.
#[derive(Debug, Clone)]
struct AckRoute {
    source_window_label: String,
    target_window_label: String,
    workspace_instance_id: String,
}

static TRANSFER_REGISTRY: Mutex<Option<HashMap<String, WorkspaceTransferData>>> = Mutex::new(None);
static ACK_ROUTES: Mutex<Option<HashMap<String, AckRoute>>> = Mutex::new(None);
static ACK_ROUTE_TARGETS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn transfer_registry(
) -> std::sync::MutexGuard<'static, Option<HashMap<String, WorkspaceTransferData>>> {
    TRANSFER_REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
}

fn ack_routes() -> std::sync::MutexGuard<'static, Option<HashMap<String, AckRoute>>> {
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
    // Pre-allocate the target label and register the transfer + ack routes
    // BEFORE creating the window. A fast-loading target could otherwise invoke
    // `claim_workspace_transfer` before the registry is populated and silently
    // lose the transfer. With registration first, the payload is always present
    // by the time the window can claim it.
    let label = window_manager::allocate_window_label();

    transfer_registry()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data.clone());
    ack_routes().get_or_insert_with(HashMap::new).insert(
        data.request_id.clone(),
        AckRoute {
            source_window_label: data.source_window_label.clone(),
            target_window_label: label.clone(),
            workspace_instance_id: data.workspace_instance_id.clone(),
        },
    );
    ack_route_targets()
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), data.request_id.clone());

    // Create the window last. On build failure, roll back the routes we just
    // registered so no orphaned transfer/ack state lingers in the registries.
    if let Err(e) = window_manager::create_document_window_with_label_and_url(
        &app,
        &label,
        "/?workspaceTransfer=true".to_string(),
    ) {
        rollback_transfer_registration(&label, &data.request_id);
        return Err(e.to_string());
    }

    Ok(label)
}

/// Remove all registry entries for a transfer that failed to launch its window.
fn rollback_transfer_registration(label: &str, request_id: &str) {
    if let Some(map) = transfer_registry().as_mut() {
        map.remove(label);
    }
    if let Some(routes) = ack_routes().as_mut() {
        routes.remove(request_id);
    }
    if let Some(targets) = ack_route_targets().as_mut() {
        targets.remove(label);
    }
}

#[tauri::command]
pub fn claim_workspace_transfer(window_label: String) -> Option<WorkspaceTransferData> {
    transfer_registry()
        .as_mut()
        .and_then(|map| map.remove(&window_label))
}

#[tauri::command]
pub fn ack_workspace_transfer(app: AppHandle, data: WorkspaceTransferAck) -> Result<(), String> {
    // Validate the ack against the registered route BEFORE mutating anything.
    // A wrong or stale ack (mismatched target window label or workspace
    // instance id) must not remove the route or notify the source — otherwise
    // a misdirected ack could cancel a still-pending transfer.
    let route_matches = {
        let routes = ack_routes();
        match routes.as_ref().and_then(|map| map.get(&data.request_id)) {
            Some(route) => {
                route.target_window_label == data.target_window_label
                    && route.workspace_instance_id == data.workspace_instance_id
            }
            // Unknown request_id — nothing to ack (idempotent no-op).
            None => return Ok(()),
        }
    };

    if !route_matches {
        log::warn!(
            "[WorkspaceTransfer] Ignoring mismatched ack for request '{}' (target '{}', instance '{}')",
            data.request_id,
            data.target_window_label,
            data.workspace_instance_id
        );
        return Ok(());
    }

    // Validated — now remove the route and target mapping, then notify source.
    let source_window_label = ack_routes()
        .as_mut()
        .and_then(|map| map.remove(&data.request_id))
        .map(|route| route.source_window_label);
    let Some(source_window_label) = source_window_label else {
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

/// Explicitly abandon a still-pending transfer from the source side (e.g. the
/// TS move timed out waiting for the target's ack). Drops the registry +
/// ack-route entries for the target window so a late `claim_workspace_transfer`
/// returns nothing and cannot apply the payload while the source keeps its tabs
/// — which would otherwise turn a failed move into a duplicate.
#[tauri::command]
pub fn cancel_workspace_transfer(target_window_label: String) {
    clear_unclaimed_transfer(&target_window_label);
}

pub fn clear_unclaimed_transfer(window_label: &str) {
    let removed = transfer_registry()
        .as_mut()
        .and_then(|map| map.remove(window_label));
    // Always drop the target mapping for this window, whether or not the payload
    // was still unclaimed. (Previously this only ran when the payload had already
    // been claimed, leaking a target entry for unclaimed/cancelled transfers.)
    let target_request_id = ack_route_targets()
        .as_mut()
        .and_then(|targets| targets.remove(window_label));
    let request_id = removed.map(|data| data.request_id).or(target_request_id);
    if let Some(request_id) = request_id {
        if let Some(routes) = ack_routes().as_mut() {
            routes.remove(&request_id);
        }
    }
}

#[cfg(test)]
#[path = "workspace_transfer.test.rs"]
mod tests;
