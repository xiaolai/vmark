//! Completed-merge surface (WI-3.7; design-3.md D3.3). The scan appends
//! a `merge-completed` diagnostic per merge SHA (deduped); this reads the
//! latest one for the breakdown's dismissible, pull-only banner. Nothing
//! runs on its own — the read happens only when the UI pulls.

use serde::Serialize;

use super::gitops::merge_commit_sha;
use super::scan::{emit_diagnostic, ScanReport};
use super::state::WorkspaceKernel;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeNotice {
    /// The merge commit SHA — the banner's dismissal key (a new merge
    /// re-shows even after an older one was dismissed).
    pub sha: String,
    pub time: String,
}

/// D3.3: if HEAD is a completed merge, append ONE diagnostic keyed by
/// its commit SHA — idempotent across repeated scans (a same-SHA rescan
/// is a no-op). Called from the scan after git classification.
pub(super) fn record_completed_merge(
    kernel: &mut WorkspaceKernel,
    existing: &mut std::collections::HashSet<(String, String)>,
    report: &mut ScanReport,
) -> Result<(), String> {
    if !kernel.is_initialized() {
        return Ok(());
    }
    let Some(sha) = merge_commit_sha(kernel.root()) else {
        return Ok(());
    };
    let is_new = !existing.contains(&("merge-completed".into(), sha.clone()));
    emit_diagnostic(
        kernel,
        existing,
        report,
        "merge-completed",
        "a git merge landed — review the breakdown",
        &sha,
    )?;
    if is_new {
        report.merges += 1;
    }
    Ok(())
}

/// The most recent completed-merge diagnostic, or None. Newest by the
/// reader's total order (spec §5.1).
pub fn perform_recent_merge(kernel: &mut WorkspaceKernel) -> Result<Option<MergeNotice>, String> {
    let read = kernel.ledger().read_all()?;
    let mut merges: Vec<(String, String)> = read
        .entries
        .iter()
        .filter(|e| e.kind == "diagnostic" && e.body["code"] == "merge-completed")
        .filter_map(|e| {
            e.body["path"]
                .as_str()
                .map(|sha| (sha.to_string(), e.time.clone()))
        })
        .collect();
    // Reader total order is (time, id); ledger entries already arrive
    // deduped and sorted, so the last merge diagnostic is the newest.
    Ok(merges.pop().map(|(sha, time)| MergeNotice { sha, time }))
}

#[tauri::command]
pub async fn coherence_recent_merge(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Option<MergeNotice>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_recent_merge(&mut kernel)
}

#[cfg(test)]
#[path = "merge_surface.test.rs"]
mod tests;
