//! The `#[tauri::command]` wrappers for the claim surface.
//!
//! Split from `claim_commands.rs` for the file-size gate, on the same seam
//! `commands.rs`/`commands_ipc.rs` already uses. The `perform_*` functions stay
//! in the parent with `String` errors — `mcp_bridge/coherence_answers.rs` calls
//! `perform_claims_list` directly and is itself a `String`-returning surface.
//!
//! @coordinates-with claim_commands.rs — the module this was split from
//! @module coherence/claim_commands_ipc

use uuid::Uuid;

use super::claim_commands::{
    perform_claim, perform_claim_scope, perform_claims_list, ClaimReceipt, ClaimRequest, ClaimRow,
};
use super::command_errors::{
    classify_write, kernel_poisoned, ledger_unavailable, rejected_argument, workspace_unavailable,
};
use crate::command_error::CommandError;

#[tauri::command]
pub async fn coherence_claim(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    request: ClaimRequest,
) -> Result<ClaimReceipt, CommandError> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state
        .registry
        .kernel_for(&root, state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    let actor = super::commands::actor_identity(&root);
    // The request carries the claim statement, scope and maturity; a rejection
    // means one of those was wrong, so the caller must send something different.
    perform_claim(&mut kernel, &request, &actor)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_claim_scope(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    context: Uuid,
    claim: Uuid,
    visible: bool,
) -> Result<(), CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Both `context` and `claim` are caller-supplied ids that may not exist.
    perform_claim_scope(&mut kernel, context, claim, visible)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_claims(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<ClaimRow>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only. NOTE: `perform_claims_list` keeps its String error — the MCP
    // bridge (coherence_answers.rs) calls it directly and is still String-typed.
    perform_claims_list(&mut kernel).map_err(ledger_unavailable)
}

#[cfg(test)]
#[path = "claim_commands.test.rs"]
mod tests;
