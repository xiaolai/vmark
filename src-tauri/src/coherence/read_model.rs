//! Shared coherence read-model (Phase 6, WI-6.1; `design-projection-framework.md`).
//! The **minimal shared interface** every coherence surface produces — one
//! `CoherenceRow` and one `Projection` trait — so a new surface (operator
//! preview, canon view, merge audit) becomes a *registration*, not a bespoke
//! panel (Theme E: defined before more panels accrue). This is additive: the
//! shipped `breakdown` is untouched; `BreakdownProjection` *wraps* it as the
//! reference implementation. Porting the other surfaces onto the trait is WI-6.2.

use std::path::PathBuf;

use super::dag::ContextView;
use super::edge_kind::OriginEdgeKind;
use super::index::CoherenceIndex;
use super::index_row::state_label;
use super::project::{project_edge, EdgeState, OriginEdge};
use super::types::{ObjectId, RevisionId};

/// The default all-live context + empty claim feed (matching `breakdown`).
const DEFAULT_CTX: &str = "00000000-0000-0000-0000-000000000000";
const EMPTY_FP: &str = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// One row of a coherence read model — the shared shape breakdown, preview,
/// merge audit, and the canon view all reduce to (validated against those four
/// in the design pass). Physical-edge identity + the projected state + display
/// metadata; nothing surface-specific.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoherenceRow {
    pub txf: String,
    pub input: u32,
    pub upstream: ObjectId,
    pub downstream: ObjectId,
    pub downstream_rev: String,
    pub upstream_path: Option<String>,
    pub downstream_path: Option<String>,
    /// The projected state, as its stable wire label (`version-stale`, …).
    pub state: String,
    /// Origin-edge kind wire tag (`dependency`, `conformance`, …).
    pub kind: String,
}

/// A coherence surface: a pure projection of the current state into rows. Every
/// implementation runs the *same* kernel projection (`project_edge` via the
/// index); the trait only varies the **lens** (which edges, under which view).
pub trait Projection {
    fn rows(&self, index: &CoherenceIndex, now: &str) -> Result<Vec<CoherenceRow>, String>;
}

/// The reference projection: the all-live-context breakdown of live non-fresh
/// edges. Wraps the shipped `breakdown` — behaviour-identical, just re-shaped to
/// the shared row.
pub struct BreakdownProjection;

impl Projection for BreakdownProjection {
    fn rows(&self, index: &CoherenceIndex, now: &str) -> Result<Vec<CoherenceRow>, String> {
        Ok(index
            .breakdown(now)?
            .into_iter()
            .map(|r| CoherenceRow {
                txf: r.txf.to_string(),
                input: r.input,
                upstream: r.upstream,
                downstream: r.downstream,
                downstream_rev: r.downstream_rev.as_str().to_string(),
                upstream_path: r.upstream_path,
                downstream_path: r.downstream_path,
                state: state_label(&r.state),
                kind: r.kind,
            })
            .collect())
    }
}

impl CoherenceIndex {
    /// Project a given edge set into shared rows (WI-6.2) — the assembly the
    /// merge-audit and incident projections share. Runs the *same* pure
    /// `project_edge`; edges that project to `None` (retired / not live) are
    /// dropped, matching breakdown.
    pub fn rows_for_edges(
        &self,
        edges: &[OriginEdge],
        now: &str,
    ) -> Result<Vec<CoherenceRow>, String> {
        let ctx = ContextView::all_live();
        let dag = self.load_dag()?;
        let all_res = self.all_resolutions()?;
        let mut out = Vec::new();
        for e in edges {
            let res = all_res.get(&(e.txf, e.input)).cloned().unwrap_or_default();
            let checks = self.live_checks(&e.txf, e.input, DEFAULT_CTX, EMPTY_FP)?;
            if let Some(state) = project_edge(e, &ctx, &dag, &res, &checks, now) {
                out.push(row_from(
                    &e.txf,
                    e.input,
                    e.upstream,
                    e.downstream,
                    &e.downstream_rev,
                    &state,
                    e.kind,
                ));
            }
        }
        Ok(out)
    }
}

/// The edges a completed git merge touched (Phase 5) as a projection (WI-6.2).
pub struct MergeAuditProjection {
    pub root: PathBuf,
}

impl Projection for MergeAuditProjection {
    fn rows(&self, index: &CoherenceIndex, now: &str) -> Result<Vec<CoherenceRow>, String> {
        let edges = super::merge_audit::merge_affected_edges(index, &self.root)?;
        index.rows_for_edges(&edges, now)
    }
}

/// The edges incident to one object (Phase 3.0 read-view) as a projection.
pub struct IncidentProjection {
    pub object: ObjectId,
}

impl Projection for IncidentProjection {
    fn rows(&self, index: &CoherenceIndex, now: &str) -> Result<Vec<CoherenceRow>, String> {
        let edges = index.edges_incident_to(&self.object)?.edges;
        index.rows_for_edges(&edges, now)
    }
}

/// Build a `CoherenceRow` from raw projection parts — the helper the other
/// surfaces (WI-6.2: preview delta, merge audit, incident) use so they all emit
/// the identical shape without duplicating field assembly.
#[allow(clippy::too_many_arguments)]
pub fn row_from(
    txf: &uuid::Uuid,
    input: u32,
    upstream: ObjectId,
    downstream: ObjectId,
    downstream_rev: &RevisionId,
    state: &EdgeState,
    kind: OriginEdgeKind,
) -> CoherenceRow {
    CoherenceRow {
        txf: txf.to_string(),
        input,
        upstream,
        downstream,
        downstream_rev: downstream_rev.as_str().to_string(),
        upstream_path: None,
        downstream_path: None,
        state: state_label(state),
        kind: kind.as_str().to_string(),
    }
}

#[cfg(test)]
#[path = "read_model.test.rs"]
mod tests;
