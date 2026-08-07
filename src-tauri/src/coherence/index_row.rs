//! Breakdown row / registry-state value types for the index read side
//! (ADR-C4 storage tier). Split from `index_query.rs` for the file-size
//! gate; `index_query` re-exports them, so import paths are unchanged.

use uuid::Uuid;

use super::project::EdgeState;
use super::types::{ObjectId, RevisionId};

/// One breakdown row: a live, non-fresh edge with display data.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct EdgeRow {
    pub txf: Uuid,
    pub input: u32,
    pub upstream: ObjectId,
    pub upstream_path: Option<String>,
    pub pinned: RevisionId,
    pub downstream: ObjectId,
    pub downstream_path: Option<String>,
    pub downstream_rev: RevisionId,
    /// Provenance confidence of the recording transformation (R28: the
    /// UI renders degraded provenance distinctly).
    pub confidence: String,
    #[serde(serialize_with = "serialize_state")]
    pub state: EdgeState,
    /// D3.4: historical waiver count on this edge — repeat divergence is
    /// visible without nagging ("previously waived ×N").
    pub prior_waivers: usize,
    /// Origin-edge kind (Phase 2, WI-2.4) — the read model reports it so the
    /// breakdown can group/label by kind. Serialized as the wire tag
    /// (`dependency`, `conformance`, …). Read-only (R23 intact).
    pub kind: String,
    /// The DOWNSTREAM is a frozen (finished) document, so upstream movement
    /// cannot invalidate it — design-lifecycle-and-anchors.md §A.
    ///
    /// Deliberately ORTHOGONAL to `state` rather than a state variant. `state`
    /// stays truthful: a frozen document's edge is still whatever it actually
    /// is, and collapsing that into a "frozen" state would both destroy that
    /// information and force `structural_class` to invent a class for a display
    /// concern — the accept precondition asks "did the affected set change
    /// structurally?", which must not shift because someone marked a document
    /// finished. The UI collapses rows where this is true; nothing is dropped.
    #[serde(default)]
    pub frozen_downstream: bool,
    /// How this edge's section anchor stands against the CURRENT upstream text
    /// — `anchor-unchanged` | `anchor-changed` | `anchor-lost`, or `None` when
    /// the edge is unanchored (whole-file behaviour, the default).
    /// design-lifecycle-and-anchors.md §B.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_status: Option<String>,
    /// Does this edge actually ASK the owner for something?
    ///
    /// The one field every consumer must use. Suppression was previously left to
    /// each caller to re-derive from `frozen_downstream` + `anchor_status`, and
    /// they promptly diverged: `perform_status` filtered while the panel rendered
    /// everything, so the badge read 0 while the list still interrupted. Deciding
    /// it once, here, makes that class of drift unrepresentable.
    ///
    /// False for a frozen downstream (a finished record upstream edits cannot
    /// invalidate) and for `anchor-unchanged` (the depended-on section did not
    /// move). `anchor-changed` and `anchor-lost` remain actionable — a broken
    /// anchor is evidence the dependency genuinely broke.
    /// (`EdgeRow` is serialize-only in Rust; the TypeScript mirror supplies its
    /// own default, which is `true` — degrade toward interrupting, never toward
    /// silence.)
    pub actionable: bool,
}

fn serialize_state<S: serde::Serializer>(state: &EdgeState, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&state_label(state))
}

pub fn state_label(state: &EdgeState) -> String {
    match state {
        EdgeState::Fresh { ratified: true, .. } => "fresh-ratified".into(),
        EdgeState::Fresh { ahead: true, .. } => "fresh-ahead".into(),
        EdgeState::Fresh { .. } => "fresh".into(),
        EdgeState::VersionStale => "version-stale".into(),
        EdgeState::StaleValid => "stale-valid".into(),
        EdgeState::StaleContradicted => "stale-contradicted".into(),
        EdgeState::StaleUnknown => "stale-unknown".into(),
        EdgeState::Waived => "waived".into(),
        EdgeState::Diverged { multi_head: true } => "diverged-multi-head".into(),
        EdgeState::Diverged { multi_head: false } => "diverged".into(),
        EdgeState::Unpinnable => "unpinnable".into(),
    }
}

/// Latest registered identity data per object (spec §5.4.6 chain, last
/// (time, id) wins) — what scan and capture consult.
#[derive(Debug, Default, Clone)]
pub struct RegistryState {
    pub path_of: std::collections::HashMap<ObjectId, String>,
    pub object_at: std::collections::HashMap<String, ObjectId>,
    pub schema_of: std::collections::HashMap<ObjectId, Option<String>>,
}

impl RegistryState {
    pub(super) fn upsert(&mut self, object: ObjectId, path: String, schema: Option<String>) {
        if let Some(old_path) = self.path_of.insert(object, path.clone()) {
            if self.object_at.get(&old_path) == Some(&object) {
                self.object_at.remove(&old_path);
            }
        }
        self.object_at.insert(path, object);
        self.schema_of.insert(object, schema);
    }

    pub fn contains(&self, object: &ObjectId) -> bool {
        self.path_of.contains_key(object)
    }
}
