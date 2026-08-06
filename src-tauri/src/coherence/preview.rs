//! Dry-run candidate projection (Phase 3, WI-3.1; ADR-P1, design D2/v4.4/v4.5).
//! Overlays a candidate revision on a **clone** of the DAG and projects the
//! affected (incident) edges — the property SP1 proved
//! (`spike_sp1_dry_run_projection.rs`), now wired to the real index and the
//! bounded read-view. Mints nothing: no ledger, CAS, or index write.
//!
//! Returns the **`local_projection_delta`** (edges whose structural class
//! changes, v4.5) and the full **structural-class map** the accept precondition
//! (v4.3) compares against at commit time.

use super::accept_precondition::{structural_class, ClassMap, PhysicalEdgeId, StructuralClass};
use super::dag::ContextView;
use super::index::CoherenceIndex;
use super::operator::Candidate;
use super::project::project_edge;
use super::types::RevisionId;

/// The default all-live context + empty claim feed the v1 preview projects under
/// (matching `breakdown`). D5.6 context-aware preview is a later increment.
const DEFAULT_CTX: &str = "00000000-0000-0000-0000-000000000000";
const EMPTY_FP: &str = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// One affected edge whose projected structural class changes under the candidate.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PreviewDelta {
    pub edge: PhysicalEdgeId,
    pub before: StructuralClass,
    pub after: StructuralClass,
}

/// The result of a dry-run candidate projection.
#[derive(Debug, Clone, PartialEq)]
pub struct Preview {
    pub candidate_revision: RevisionId,
    /// Edges whose class changed (incl. `Some → Retired` retirements) — v4.5.
    pub local_delta: Vec<PreviewDelta>,
    /// Every affected edge's *candidate-time* class, keyed by physical id — the
    /// snapshot the accept precondition reproject compares against (v4.3).
    pub structural_classes: ClassMap,
    /// The affected set hit `PREVIEW_MAX_EDGES` — the preview is bounded (v4.4).
    pub truncated: bool,
}

impl CoherenceIndex {
    /// Project a candidate without committing (ADR-P1). Pure over the current
    /// index state + the transient overlay.
    pub fn project_candidates(&self, candidate: &Candidate, now: &str) -> Result<Preview, String> {
        let affected = self.edges_incident_to(&candidate.object)?;
        // Bounded sub-dag (WI-3.4 perf): only the candidate's object and each
        // affected edge's upstream+downstream — the objects `project_edge`
        // actually resolves — never the whole corpus.
        let mut objects = vec![candidate.object];
        for e in &affected.edges {
            objects.push(e.upstream);
            objects.push(e.downstream);
        }
        let base_dag = self.load_sub_dag(&objects)?;
        let mut overlay = base_dag.clone();
        overlay.record_output(
            candidate.object,
            candidate.revision.clone(),
            candidate.parents.clone(),
        );
        let ctx = ContextView::all_live();
        let all_res = self.all_resolutions()?;

        let mut classes = ClassMap::new();
        let mut local_delta = Vec::new();
        for edge in &affected.edges {
            let res = all_res
                .get(&(edge.txf, edge.input))
                .cloned()
                .unwrap_or_default();
            let checks = self.live_checks(&edge.txf, edge.input, DEFAULT_CTX, EMPTY_FP)?;
            let before =
                structural_class(project_edge(edge, &ctx, &base_dag, &res, &checks, now).as_ref());
            let after =
                structural_class(project_edge(edge, &ctx, &overlay, &res, &checks, now).as_ref());
            let pid = PhysicalEdgeId {
                txf: edge.txf,
                input: edge.input,
                downstream: edge.downstream,
                downstream_rev: edge.downstream_rev.clone(),
            };
            classes.insert(pid.clone(), after.clone());
            if before != after {
                local_delta.push(PreviewDelta {
                    edge: pid,
                    before,
                    after,
                });
            }
        }
        // Deterministic order for display + comparison.
        local_delta.sort_by_key(|d| (d.edge.txf, d.edge.input));
        Ok(Preview {
            candidate_revision: candidate.revision.clone(),
            local_delta,
            structural_classes: classes,
            truncated: affected.truncated,
        })
    }
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
