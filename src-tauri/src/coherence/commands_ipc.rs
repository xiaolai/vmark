//! The `#[tauri::command]` wrappers for the core coherence surface.
//!
//! Split out of `commands.rs` for size. The seam is the IPC boundary: this file is
//! only argument marshalling and kernel lookup, while the `perform_*` functions
//! it delegates to — the real behaviour, and what the tests drive — stay in the
//! parent.
//!
//! @coordinates-with commands.rs — the module this was split from
//! @module coherence/commands_ipc

use super::command_types::{actor_identity, CoherenceStatus, ResolveReceipt, ResolveRequest};
use super::commands::{perform_breakdown_in, perform_resolve, perform_status, CoherenceState};

use serde_json::json;

use super::capture::{capture, CaptureReceipt, CaptureRequest};
use super::index_query::EdgeRow;
use super::scan::{scan_workspace, ScanReport};

#[tauri::command]
pub async fn coherence_capture(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: CaptureRequest,
) -> Result<CaptureReceipt, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    capture(&mut kernel, request)
}

#[tauri::command]
pub async fn coherence_resolve(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: ResolveRequest,
) -> Result<ResolveReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let actor = actor_identity(&root);
    perform_resolve(&mut kernel, &request, &actor)
}

#[tauri::command]
pub async fn coherence_breakdown(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    context: Option<uuid::Uuid>,
) -> Result<Vec<EdgeRow>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_breakdown_in(&mut kernel, context)
}

#[tauri::command]
pub async fn coherence_status(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<CoherenceStatus, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_status(&mut kernel)
}

/// Read-time head lookup (audit T5): MCP reads pin the revision that was
/// actually served, so a later upstream edit cannot be misattributed as
/// the write's input. Null when the path is not a known single-headed
/// object.
#[tauri::command]
pub async fn coherence_head(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    kernel.ensure_available()?; // 8R-5: never serve a half-rebuilt index
    let registry = kernel.index().registry_state()?;
    let Some(object) = registry.object_at.get(&path) else {
        return Ok(None);
    };
    let heads = kernel.index().heads(object)?;
    match heads.as_slice() {
        [only] => Ok(Some(json!({ "object": object, "revision": only }))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn coherence_scan(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<ScanReport, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    scan_workspace(&mut kernel)
}
