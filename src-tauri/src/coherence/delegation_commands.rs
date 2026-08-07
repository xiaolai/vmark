//! Delegation IPC surface (WI-3.4; design-3.md D2.2 — in-app explicit
//! human acts only). List + grant/revoke; the confirmation dialog lives
//! in the UI, this layer records the already-confirmed act.

use super::command_errors::{
    classify_write, kernel_poisoned, ledger_unavailable, rejected_argument, workspace_unavailable,
};
use crate::command_error::CommandError;
use serde::Serialize;
use uuid::Uuid;

use super::delegation::{perform_delegate, DelegateReceipt, DelegateRequest, DelegationStore};
use super::state::WorkspaceKernel;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationRow {
    pub grant: Uuid,
    pub delegate: String,
    pub scope: Vec<String>,
    pub expires: String,
}

pub fn perform_delegations_list(
    kernel: &mut WorkspaceKernel,
) -> Result<Vec<DelegationRow>, String> {
    let read = kernel.ledger().read_all()?;
    let store = DelegationStore::from_entries(&read.entries);
    Ok(store
        .all_current()
        .into_iter()
        .filter(|e| !e.scope.is_empty()) // revoked grants drop from the list
        .map(|e| DelegationRow {
            grant: e.grant,
            delegate: e.delegate.clone(),
            scope: e.scope.clone(),
            expires: e.expires.clone(),
        })
        .collect())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[tauri::command]
pub async fn coherence_delegations(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<DelegationRow>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only projection of the live delegations.
    perform_delegations_list(&mut kernel).map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_delegate(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    request: DelegateRequest,
) -> Result<DelegateReceipt, CommandError> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state
        .registry
        .kernel_for(&root, state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    let actor = super::commands::actor_identity(&root);
    // The request names the scope and principal being delegated to; an
    // unknown scope or malformed principal is the caller's to fix.
    perform_delegate(&mut kernel, &request, &actor, &now_rfc3339())
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[cfg(test)]
#[path = "delegation_commands.test.rs"]
mod tests;
