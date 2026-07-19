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
use super::project::{project_edge, OriginEdge};
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
        let base_dag = self.load_dag()?;
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

/// A multi-object group preview (Phase 4 / the multi-object increment). Overlays
/// ALL the group's candidate revisions at once and projects the union affected
/// set — so interactions between the members through *existing* edges are
/// visible. Captures both the base and the group class maps.
///
/// It also overlays the **new** edges the members create from their own inputs
/// (e.g. Extract-Canon's conformance edges), so the preview `local_delta` shows
/// them (design-accept-consistency #5). These are display-only: they carry a
/// synthetic nil txf (real edge txfs are v7 ids, never nil) and are added to
/// `local_delta` only — NOT to `base_classes`, so the accept precondition still
/// compares committed edges alone (a brand-new edge has no pre-image to be
/// unstable against), which stays correct.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupPreview {
    pub local_delta: Vec<PreviewDelta>,
    /// Affected edges' classes **before** the group (base) — the accept
    /// precondition compares the live base against this.
    pub base_classes: ClassMap,
    /// Affected edges' classes **after** overlaying the whole group.
    pub group_classes: ClassMap,
    pub truncated: bool,
}

impl CoherenceIndex {
    /// Project a group of candidates (distinct objects) without committing.
    pub fn project_group(
        &self,
        candidates: &[Candidate],
        now: &str,
    ) -> Result<GroupPreview, String> {
        let ctx = ContextView::all_live();
        let base_dag = self.load_dag()?;
        let mut overlay = base_dag.clone();
        for c in candidates {
            overlay.record_output(c.object, c.revision.clone(), c.parents.clone());
        }
        // Union of every changed object's incident edges (deduped by physical id).
        let mut seen = std::collections::HashSet::new();
        let mut affected = Vec::new();
        let mut truncated = false;
        for c in candidates {
            let inc = self.edges_incident_to(&c.object)?;
            truncated |= inc.truncated;
            for e in inc.edges {
                let key = (e.txf, e.input, e.downstream, e.downstream_rev.clone());
                if seen.insert(key) {
                    affected.push(e);
                }
            }
        }
        let all_res = self.all_resolutions()?;
        let mut base_classes = ClassMap::new();
        let mut group_classes = ClassMap::new();
        let mut local_delta = Vec::new();
        for edge in &affected {
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
            base_classes.insert(pid.clone(), before.clone());
            group_classes.insert(pid.clone(), after.clone());
            if before != after {
                local_delta.push(PreviewDelta {
                    edge: pid,
                    before,
                    after,
                });
            }
        }

        // #5: overlay the NEW edges each member creates from its own inputs
        // (e.g. Extract-Canon's conformance edges). Display-only — a synthetic
        // nil txf keeps them distinct from every committed edge, and they land in
        // `local_delta` only (never `base_classes`), so the precondition is
        // untouched. A brand-new edge's "before" is `Retired` (it did not exist).
        let synth_txf = uuid::Uuid::nil();
        for c in candidates {
            for (i, input) in c.inputs.iter().enumerate() {
                let idx = i as u32;
                let edge = OriginEdge {
                    txf: synth_txf,
                    input: idx,
                    upstream: input.object,
                    pinned: input.revision.clone(),
                    downstream: c.object,
                    downstream_rev: c.revision.clone(),
                    role: input.role,
                    kind: input.kind,
                };
                // A brand-new edge has no resolutions or checks yet.
                let res = all_res.get(&(synth_txf, idx)).cloned().unwrap_or_default();
                let checks = self.live_checks(&synth_txf, idx, DEFAULT_CTX, EMPTY_FP)?;
                let after = structural_class(
                    project_edge(&edge, &ctx, &overlay, &res, &checks, now).as_ref(),
                );
                if after != StructuralClass::Retired {
                    local_delta.push(PreviewDelta {
                        edge: PhysicalEdgeId {
                            txf: synth_txf,
                            input: idx,
                            downstream: c.object,
                            downstream_rev: c.revision.clone(),
                        },
                        before: StructuralClass::Retired,
                        after,
                    });
                }
            }
        }

        local_delta.sort_by_key(|d| (d.edge.txf, d.edge.input, d.edge.downstream.0));
        Ok(GroupPreview {
            local_delta,
            base_classes,
            group_classes,
            truncated,
        })
    }
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
