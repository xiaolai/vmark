//! The `#[tauri::command]` wrappers for the context surface.
//!
//! Split from `context_commands.rs` for the file-size gate, on the same seam
//! `commands.rs`/`commands_ipc.rs` already uses: this file is argument
//! marshalling and error typing only, while the `perform_*` functions it calls
//! — the real behaviour, and what the tests and the MCP bridge drive — stay in
//! the parent and keep their `String` errors.
//!
//! @coordinates-with context_commands.rs — the module this was split from
//! @module coherence/context_commands_ipc

use uuid::Uuid;

use super::command_errors::{
    classify_write, kernel_poisoned, ledger_unavailable, rejected_argument, state_conflict,
    workspace_unavailable,
};
use super::context_commands::{
    perform_branch_candidate, perform_context_create, perform_context_create_from_branch,
    perform_context_enforce, perform_contexts_list, BranchCandidate,
};
use super::context_types::{ContextReceipt, ContextRow};
use crate::command_error::CommandError;

#[tauri::command]
pub async fn coherence_branch_candidate(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Option<BranchCandidate>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only: inspects git + the context set, takes no argument to reject.
    perform_branch_candidate(&mut kernel).map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_context_from_branch(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<ContextReceipt, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Derives the name from the CURRENT branch, so a failure is workspace state
    // (detached HEAD, a name already taken) rather than a caller argument.
    perform_context_create_from_branch(&mut kernel)
        .map_err(|e| classify_write(&kernel, state_conflict, e))
}

#[tauri::command]
pub async fn coherence_contexts(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<ContextRow>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only projection of the manifests on disk.
    perform_contexts_list(&mut kernel).map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_context_create(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    name: String,
    parent: Option<Uuid>,
) -> Result<ContextReceipt, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // The caller supplies both the name and the parent id; a rejection means one
    // of them was wrong (empty/duplicate name, unknown or cyclic parent).
    perform_context_create(&mut kernel, &name, parent)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_context_enforce(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    context: Uuid,
    enforcing: bool,
) -> Result<(), CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // `context` is a caller-supplied id that may not exist.
    perform_context_enforce(&mut kernel, context, enforcing)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[cfg(test)]
#[path = "context_commands.test.rs"]
mod tests;
