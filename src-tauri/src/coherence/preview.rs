//! Dry-run candidate projection (Phase 3, WI-3.1; ADR-P1, design D2/v4.4/v4.5).
//! Overlays a candidate revision on a **clone** of the DAG and projects the
//! affected (incident) edges — the property SP1 proved
//! (`spike_sp1_dry_run_projection.rs`), now wired to the real index and the
//! bounded read-view. Mints nothing: no ledger, CAS, or index write.
//!
//! Returns the **`local_projection_delta`** (edges whose structural class
//! changes, v4.5) and the full **structural-class map** the accept precondition
//! (v4.3) compares against at commit time.

use sha2::{Digest, Sha256};

use super::accept_precondition::{structural_class, ClassMap, PhysicalEdgeId, StructuralClass};
use super::dag::ContextView;
use super::index::CoherenceIndex;
use super::operator::Candidate;
use super::project::{project_edge, OriginEdge};
use super::types::RevisionId;

/// A deterministic preview-only edge id for a not-yet-committed candidate edge
/// (re-review #8 / MINOR). Derived from the member revision + input index and
/// domain-separated, so it is (a) STABLE between preview and the accept-time
/// reproject — letting the new edge's projected class gate the precondition —
/// and (b) NOT a value the ledger parser accepts for a real edge (unlike a nil
/// txf, which a merged/external ledger could actually carry).
fn synthetic_edge_txf(candidate_rev: &str, input_idx: u32) -> uuid::Uuid {
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(b"vmark-preview-edge-v1");
    buf.extend_from_slice(&(candidate_rev.len() as u32).to_be_bytes());
    buf.extend_from_slice(candidate_rev.as_bytes());
    buf.extend_from_slice(&input_idx.to_be_bytes());
    let digest: [u8; 32] = Sha256::digest(&buf).into();
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x80; // version 8 (custom)
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10 (RFC-4122)
    uuid::Uuid::from_bytes(b)
}

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
/// them (design-accept-consistency #5) AND their projected after-class is
/// captured in `new_edge_classes` for the accept precondition (re-review #8):
/// a new edge pinned to an external upstream can go stale if that upstream
/// advances between preview and accept, so accept must re-check it, not just the
/// committed base edges. Synthetic edges carry a deterministic preview-only id
/// (not a real txf) and read NO persisted resolution/check state.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupPreview {
    pub local_delta: Vec<PreviewDelta>,
    /// Affected COMMITTED edges' classes **before** the group (base) — accept
    /// compares the live base against this.
    pub base_classes: ClassMap,
    /// Affected committed edges' classes **after** overlaying the whole group.
    pub group_classes: ClassMap,
    /// The members' NEW edges' projected after-classes (keyed by preview-only
    /// id). Accept re-checks these too (#8) — a new edge's upstream can advance
    /// between preview and accept even when every base head is unchanged.
    pub new_edge_classes: ClassMap,
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

        // #5/#8: overlay the NEW edges each member creates from its own inputs
        // (e.g. Extract-Canon's conformance edges). Each gets a deterministic
        // preview-only id (stable across the accept reproject) and reads NO
        // persisted resolution/check state (empty slices — re-review MINOR). The
        // projected after-class goes in `new_edge_classes` (so accept re-checks
        // it, #8) and, when non-trivial, in `local_delta` for display. A
        // brand-new edge's display "before" is `Retired` (it did not exist).
        let mut new_edge_classes = ClassMap::new();
        for c in candidates {
            for (i, input) in c.inputs.iter().enumerate() {
                let idx = i as u32;
                let synth_txf = synthetic_edge_txf(c.revision.as_str(), idx);
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
                let after =
                    structural_class(project_edge(&edge, &ctx, &overlay, &[], &[], now).as_ref());
                let pid = PhysicalEdgeId {
                    txf: synth_txf,
                    input: idx,
                    downstream: c.object,
                    downstream_rev: c.revision.clone(),
                };
                new_edge_classes.insert(pid.clone(), after.clone());
                if after != StructuralClass::Retired {
                    local_delta.push(PreviewDelta {
                        edge: pid,
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
            new_edge_classes,
            truncated,
        })
    }
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
