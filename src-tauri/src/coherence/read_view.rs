//! Bounded preview read-view (Phase 3.0, WI-3.0a; design v4.4). The forward-
//! operator preview must project only the edges INCIDENT to the changed object
//! (`upstream ∪ downstream`), not the whole graph the full breakdown loads. This
//! adds the targeted incident-edge query over the `edges_by_upstream` /
//! `edges_by_downstream` indexes, capped at `PREVIEW_MAX_EDGES` so a super-hub
//! (a canon with N conformers) surfaces "truncated" rather than loading
//! unbounded rows.

use uuid::Uuid;

use super::edge_kind::OriginEdgeKind;
use super::index::CoherenceIndex;
use super::project::OriginEdge;
use super::types::{InputRole, ObjectId, RevisionId};

/// Upper bound on edges a single preview loads (design v4.4). A changed object
/// incident to more than this many edges is reported truncated, not partial.
pub const PREVIEW_MAX_EDGES: usize = 2000;

/// The affected edge set for a changed object, plus whether it was capped.
#[derive(Debug, Clone, PartialEq)]
pub struct IncidentEdges {
    pub edges: Vec<OriginEdge>,
    /// True when the object is incident to more than `PREVIEW_MAX_EDGES` edges —
    /// the preview is bounded and must surface this, never silently drop rows.
    pub truncated: bool,
}

impl CoherenceIndex {
    /// Edges incident to `object` (as upstream OR downstream), bounded. This is
    /// the affected-set discovery a candidate preview overlays onto (v4.4). The
    /// union is de-duplicated by physical identity `(txf, input, downstream,
    /// downstream_rev)`.
    pub fn edges_incident_to(&self, object: &ObjectId) -> Result<IncidentEdges, String> {
        // One row over the limit tells us truncation happened without a second
        // COUNT round-trip.
        let probe = (PREVIEW_MAX_EDGES + 1) as i64;
        let oid = object.0.to_string();
        let mut stmt = self
            .conn
            .prepare(
                "SELECT txf, input_idx, upstream, pinned, downstream, downstream_rev, role, edge_kind
                 FROM edges WHERE upstream = ?1 OR downstream = ?1
                 ORDER BY txf, input_idx, downstream, downstream_rev
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![oid, probe], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut edges = Vec::new();
        for row in rows {
            let (txf, idx, up, pinned, down, down_rev, role, kind) =
                row.map_err(|e| e.to_string())?;
            edges.push(OriginEdge {
                txf: Uuid::parse_str(&txf).map_err(|e| e.to_string())?,
                input: idx as u32,
                upstream: ObjectId(Uuid::parse_str(&up).map_err(|e| e.to_string())?),
                pinned: RevisionId::parse(&pinned)?,
                downstream: ObjectId(Uuid::parse_str(&down).map_err(|e| e.to_string())?),
                downstream_rev: RevisionId::parse(&down_rev)?,
                role: if role == "direct" {
                    InputRole::Direct
                } else {
                    InputRole::Contextual
                },
                kind: OriginEdgeKind::parse(&kind),
            });
        }
        let truncated = edges.len() > PREVIEW_MAX_EDGES;
        edges.truncate(PREVIEW_MAX_EDGES);
        Ok(IncidentEdges { edges, truncated })
    }

    /// The edges affected by a set of changed objects — the union of each
    /// object's incident edges, **deduplicated by physical identity**
    /// (`txf, input, downstream, downstream_rev`). This is the deterministic,
    /// total object→edge half of the merge-audit mapping (Phase 5, SP4/WI-5.1):
    /// a completed merge's changed files map (via the registry) to changed
    /// objects, and thence here to the edges to re-check. Order is deterministic
    /// (sorted by physical identity).
    pub fn edges_affected_by(&self, objects: &[ObjectId]) -> Result<Vec<OriginEdge>, String> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for object in objects {
            for edge in self.edges_incident_to(object)?.edges {
                let key = (
                    edge.txf,
                    edge.input,
                    edge.downstream,
                    edge.downstream_rev.clone(),
                );
                if seen.insert(key) {
                    out.push(edge);
                }
            }
        }
        out.sort_by(|a, b| {
            (a.txf, a.input, a.downstream, a.downstream_rev.as_str()).cmp(&(
                b.txf,
                b.input,
                b.downstream,
                b.downstream_rev.as_str(),
            ))
        });
        Ok(out)
    }
}

#[cfg(test)]
#[path = "read_view.test.rs"]
mod tests;
