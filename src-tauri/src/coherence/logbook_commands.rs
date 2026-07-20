//! Tauri surface for the coherence logbook (see `logbook.rs`).
//!
//! `coherence_logbook` is READ-ONLY — it projects the ledger, mints nothing.
//! `coherence_flag_judgment` is the single mutation: the owner's M2 relevance
//! judgment for one flagged edge, appended through the same workspace lock as
//! every other writer.

use serde::Serialize;
use uuid::Uuid;

use super::lifecycle::set_lifecycle;
use super::logbook::{append_flag_judgment, m2_summary, project_logbook, LogEntry, M2Summary};
use super::types::ObjectId;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogbookView {
    pub rows: Vec<LogEntry>,
    pub m2: M2Summary,
    /// Edges resolved more than once — the churn that drives M4's burden.
    /// Surfaced as its own count so "few edges, many times" is visible without
    /// the caller having to re-derive it from the rows.
    pub reopened_edges: usize,
}

/// Project the logbook for a workspace (read-only).
#[tauri::command]
pub async fn coherence_logbook(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<LogbookView, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    kernel.ensure_available()?; // 9R-4: never serve a poisoned index
    let read = kernel.ledger().read_all()?;
    let rows = project_logbook(&read.entries);
    let m2 = m2_summary(&rows);
    let reopened_edges = rows.iter().filter(|r| r.resolutions > 1).count();
    Ok(LogbookView {
        rows,
        m2,
        reopened_edges,
    })
}

/// Record the owner's judgment of one flagged edge (the M2 datum).
#[tauri::command]
pub async fn coherence_flag_judgment(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    txf: Uuid,
    input: u32,
    judgment: String,
    note: Option<String>,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let id = append_flag_judgment(
        &mut kernel,
        &txf,
        input,
        &judgment,
        note.as_deref().unwrap_or_default(),
    )?;
    Ok(id.to_string())
}

/// Mark a document `frozen` (a finished record) or back to `live`.
/// design-lifecycle-and-anchors.md §A — human-set, never inferred.
#[tauri::command]
pub async fn coherence_set_lifecycle(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    object: Uuid,
    lifecycle: String,
    reason: Option<String>,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let id = set_lifecycle(
        &mut kernel,
        &ObjectId(object),
        &lifecycle,
        reason.as_deref().unwrap_or_default(),
    )?;
    Ok(id.to_string())
}

/// Anchor an edge to a heading path (empty clears it, restoring whole-file
/// behaviour). design-lifecycle-and-anchors.md §B.
#[tauri::command]
pub async fn coherence_set_anchor(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    txf: Uuid,
    input: u32,
    headings: Vec<String>,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let id = super::anchors::set_anchor(&mut kernel, &txf, input, &headings)?;
    Ok(id.to_string())
}

#[cfg(test)]
#[path = "logbook_commands.test.rs"]
mod tests;
