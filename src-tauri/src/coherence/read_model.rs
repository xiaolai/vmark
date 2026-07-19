//! Shared coherence read-model (Phase 6, WI-6.1; `design-projection-framework.md`).
//! The **minimal shared interface** every coherence surface produces — one
//! `CoherenceRow` and one `Projection` trait — so a new surface (operator
//! preview, canon view, merge audit) becomes a *registration*, not a bespoke
//! panel (Theme E: defined before more panels accrue). This is additive: the
//! shipped `breakdown` is untouched; `BreakdownProjection` *wraps* it as the
//! reference implementation. Porting the other surfaces onto the trait is WI-6.2.

use super::edge_kind::OriginEdgeKind;
use super::index::CoherenceIndex;
use super::index_row::state_label;
use super::project::EdgeState;
use super::types::{ObjectId, RevisionId};

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
