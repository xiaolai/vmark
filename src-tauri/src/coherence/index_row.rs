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
