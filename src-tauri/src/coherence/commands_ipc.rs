//! The `#[tauri::command]` wrappers for the core coherence surface.
//!
//! Split out of `commands.rs` for size. The seam is the IPC boundary: this file is
//! only argument marshalling and kernel lookup, while the `perform_*` functions
//! it delegates to — the real behaviour, and what the tests drive — stay in the
//! parent.
//!
//! @coordinates-with commands.rs — the module this was split from
//! @module coherence/commands_ipc

use super::command_errors::{
    classify_write, kernel_poisoned, ledger_unavailable, rejected_argument, workspace_unavailable,
};
use super::command_types::{actor_identity, CoherenceStatus, ResolveReceipt, ResolveRequest};
use super::commands::{perform_breakdown_in, perform_resolve, perform_status, CoherenceState};
use crate::command_error::CommandError;

use serde_json::json;

use super::capture::{capture, CaptureReceipt, CaptureRequest};
use super::index_query::EdgeRow;
use super::scan::{scan_workspace, ScanReport};

#[tauri::command]
pub async fn coherence_capture(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: CaptureRequest,
) -> Result<CaptureReceipt, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // `capture` validates the REQUEST before any side effect (8R-9: input caps,
    // `confidence=unknown` is scan-only, unknown object), so a rejected argument
    // is the dominant caller-actionable failure.
    capture(&mut kernel, request).map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_resolve(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: ResolveRequest,
) -> Result<ResolveReceipt, CommandError> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state
        .registry
        .kernel_for(&root, state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    let actor = actor_identity(&root);
    // A resolution names an edge and a verdict; the caller's remedy for a
    // rejection is to send a different one.
    perform_resolve(&mut kernel, &request, &actor)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_breakdown(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    context: Option<uuid::Uuid>,
) -> Result<Vec<EdgeRow>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only projection: nothing here is an argument problem.
    perform_breakdown_in(&mut kernel, context).map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_status(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<CoherenceStatus, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    perform_status(&mut kernel).map_err(ledger_unavailable)
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
) -> Result<Option<serde_json::Value>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    kernel.ensure_available().map_err(ledger_unavailable)?; // 8R-5: never serve a half-rebuilt index
    let registry = kernel
        .index()
        .registry_state()
        .map_err(ledger_unavailable)?;
    // An unknown path is NOT an error: `null` is the documented answer for "not
    // a known single-headed object" (audit T5), and turning it into `not-found`
    // would make every read of an untracked file look like a failure.
    let Some(object) = registry.object_at.get(&path) else {
        return Ok(None);
    };
    let heads = kernel.index().heads(object).map_err(ledger_unavailable)?;
    match heads.as_slice() {
        [only] => Ok(Some(json!({ "object": object, "revision": only }))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn coherence_scan(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<ScanReport, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // A scan walks the workspace and appends its findings; a failure is the
    // environment (unreadable tree, ledger) rather than the caller's argument,
    // which is only a workspace root the registry already accepted.
    scan_workspace(&mut kernel).map_err(|e| classify_write(&kernel, ledger_unavailable, e))
}
