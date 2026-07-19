//! Forward-operator Tauri surface (Phase 3, WI-3.6). Three commands wiring the
//! tested operator layer: `propose` and `preview` are **read-only** (MCP-safe,
//! R23); `accept` is the **human-only** mutation (D6 — delegated `operator.accept`
//! is a separate deferred scope, never the `resolve` path).
//!
//! Candidates are content-addressed and **resubmitted whole** across IPC (v4.6):
//! the server recomputes the revision id from the payload (the tamper check), so
//! there is no server-side candidate session to survive a restart.

use serde::{Deserialize, Serialize};

use super::accept::{accept_candidate, AcceptReceipt};
use super::accept_precondition::{PhysicalEdgeId, StructuralClass};
use super::dag::Resolved;
use super::operator::{tidy_revise, Candidate};
use super::preview::PreviewDelta;
use super::types::{InputRef, ObjectId, RevisionId};

/// A candidate on the wire — the shape `propose` returns and `preview`/`accept`
/// resubmit. `revision` is display-only; the server recomputes it (Candidate::new).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorCandidate {
    pub object: ObjectId,
    pub content: String,
    pub base: RevisionId,
    #[serde(default)]
    pub inputs: Vec<InputRef>,
    pub operator: String,
    pub summary: String,
    #[serde(default)]
    pub revision: String,
}

impl OperatorCandidate {
    fn to_candidate(&self) -> Candidate {
        Candidate::new(
            self.object,
            self.content.clone(),
            self.base.clone(),
            self.inputs.clone(),
            &self.operator,
            &self.summary,
        )
    }
    fn from_candidate(c: &Candidate) -> Self {
        Self {
            object: c.object,
            content: c.content.clone(),
            base: c
                .parents
                .first()
                .cloned()
                .unwrap_or_else(|| c.revision.clone()),
            inputs: c.inputs.clone(),
            operator: c.operator.clone(),
            summary: c.summary.clone(),
            revision: c.revision.as_str().to_string(),
        }
    }
}

/// The preview a client holds between `preview` and `accept` (v4.3/v4.6).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub candidate_revision: String,
    pub local_delta: Vec<PreviewDelta>,
    /// The structural-class snapshot the client resubmits to `accept`.
    pub structural_classes: Vec<(PhysicalEdgeId, StructuralClass)>,
    pub truncated: bool,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Run the operator over an object's current text, returning its candidates
/// (read-only). `content` is the live editor text (may lead the committed head).
#[tauri::command]
pub async fn coherence_operator_propose(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    object: ObjectId,
    content: String,
) -> Result<Vec<OperatorCandidate>, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let base = match kernel.index().resolve_live(&object)? {
        Resolved::Single(rev) => rev,
        _ => return Err("object has no single live head to revise".into()),
    };
    Ok(tidy_revise(object, base, &content)
        .iter()
        .map(OperatorCandidate::from_candidate)
        .collect())
}

/// Project a candidate without committing (read-only). Returns the delta + the
/// structural-class snapshot for a later accept.
#[tauri::command]
pub async fn coherence_operator_preview(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    candidate: OperatorCandidate,
) -> Result<PreviewResult, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let preview = kernel
        .index()
        .project_candidates(&candidate.to_candidate(), &now_rfc3339())?;
    Ok(PreviewResult {
        candidate_revision: preview.candidate_revision.as_str().to_string(),
        local_delta: preview.local_delta,
        structural_classes: preview.structural_classes.into_iter().collect(),
        truncated: preview.truncated,
    })
}

/// Accept a previewed candidate (human-only mutation). The client resubmits the
/// candidate payload + the preview's structural classes (v4.6).
#[tauri::command]
pub async fn coherence_operator_accept(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    candidate: OperatorCandidate,
    structural_classes: Vec<(PhysicalEdgeId, StructuralClass)>,
) -> Result<AcceptReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    let preview_classes = structural_classes.into_iter().collect();
    accept_candidate(
        &mut kernel,
        &candidate.to_candidate(),
        &preview_classes,
        &now_rfc3339(),
    )
}

#[cfg(test)]
#[path = "operator_commands.test.rs"]
mod tests;
