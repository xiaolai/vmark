//! Provenance IPC surface + index queries (WI-3.1/3.2, split from
//! `provenance.rs` for the file-size gate).

use uuid::Uuid;

use super::provenance::{
    perform_confirm_inputs, perform_propose_inputs, perform_provenance_candidates, ConfirmReceipt,
    ConfirmRequest, Proposal, ProvenanceCandidate,
};
use super::types::{ObjectId, RevisionId};

#[tauri::command]
pub async fn coherence_provenance_candidates(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<ProvenanceCandidate>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_provenance_candidates(&mut kernel)
}

#[tauri::command]
pub async fn coherence_propose_inputs(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    path: String,
) -> Result<Proposal, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_propose_inputs(&mut kernel, &path)
}

#[tauri::command]
pub async fn coherence_confirm_inputs(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    request: ConfirmRequest,
) -> Result<ConfirmReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let actor = super::commands::actor_identity(&root);
    perform_confirm_inputs(&mut kernel, &request, &actor)
}

impl super::index::CoherenceIndex {
    /// Any edges recorded at exactly this (object, revision)? D1 gates
    /// proposals on the head having none.
    pub(super) fn has_live_edges(
        &self,
        object: &ObjectId,
        rev: &RevisionId,
    ) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM edges WHERE downstream = ?1 AND downstream_rev = ?2 LIMIT 1",
                rusqlite::params![object.0.to_string(), rev.as_str()],
                |_| Ok(()),
            )
            .map(|_| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other.to_string()),
            })
    }

    /// The input set recorded at (object, revision) by its most recent
    /// transformation (UUIDv7 txf ids are time-ordered), roles intact.
    pub(super) fn inputs_recorded_at(
        &self,
        object: &ObjectId,
        rev: &RevisionId,
    ) -> Result<Vec<(ObjectId, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT upstream, role FROM edges
                 WHERE downstream = ?1 AND downstream_rev = ?2
                   AND txf = (SELECT MAX(txf) FROM edges
                              WHERE downstream = ?1 AND downstream_rev = ?2)
                 ORDER BY input_idx",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![object.0.to_string(), rev.as_str()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (obj, role) = row.map_err(|e| e.to_string())?;
            out.push((
                ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?),
                role,
            ));
        }
        Ok(out)
    }
}
