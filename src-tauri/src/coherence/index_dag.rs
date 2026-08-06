//! Revision-DAG loading and head resolution out of the index.
//!
//! Split out of `index_query.rs` for size. The seam is the shape being read:
//! this file reconstructs the revision graph (whole or bounded to a sub-DAG)
//! and answers head/content lookups, while `index_query.rs` keeps the
//! breakdown/registry projections built on top of it.
//!
//! The sub-DAG variant is load-bearing, not an optimisation detail: preview was
//! O(corpus) until it could bound the walk to the objects actually involved.
//!
//! @coordinates-with index_query.rs — the projections over this graph
//! @module coherence/index_dag

use uuid::Uuid;

use super::dag::RevisionDag;
use super::index::CoherenceIndex;
use super::types::{ObjectId, RevisionId};

impl CoherenceIndex {
    pub(super) fn load_dag(&self) -> Result<RevisionDag, String> {
        let mut dag = RevisionDag::default();
        let mut stmt = self
            .conn
            .prepare("SELECT object, revision, parents FROM revisions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (obj, rev, parents_json) = row.map_err(|e| e.to_string())?;
            let object = ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?);
            let revision = RevisionId::parse(&rev)?;
            let parents: Vec<RevisionId> =
                serde_json::from_str(&parents_json).map_err(|e| e.to_string())?;
            dag.record_output(object, revision, parents);
        }
        Ok(dag)
    }
    /// Load ONLY the revisions of the given objects — the bounded sub-dag a
    /// preview needs (WI-3.4 perf, design-accept-consistency Blocker 2). A
    /// preview projects a candidate's incident edges, each resolving its own
    /// upstream+downstream objects; those objects' full revision histories are
    /// all `resolve`/`project_edge` touch, so a whole-corpus `load_dag` (+ clone)
    /// is O(corpus) memory for no reason. This is O(revisions of `objects`).
    /// Deduplicates the id list; returns an empty dag for an empty input.
    pub(super) fn load_sub_dag(&self, objects: &[ObjectId]) -> Result<RevisionDag, String> {
        let mut dag = RevisionDag::default();
        let unique: std::collections::HashSet<String> =
            objects.iter().map(|o| o.0.to_string()).collect();
        if unique.is_empty() {
            return Ok(dag);
        }
        let ids: Vec<String> = unique.into_iter().collect();
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!(
            "SELECT object, revision, parents FROM revisions WHERE object IN ({placeholders})"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (obj, rev, parents_json) = row.map_err(|e| e.to_string())?;
            let object = ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?);
            let revision = RevisionId::parse(&rev)?;
            let parents: Vec<RevisionId> =
                serde_json::from_str(&parents_json).map_err(|e| e.to_string())?;
            dag.record_output(object, revision, parents);
        }
        Ok(dag)
    }
    /// Current head set of an object (never a global latest — R10).
    pub fn heads(&self, object: &ObjectId) -> Result<Vec<RevisionId>, String> {
        Ok(self.load_dag()?.heads(object))
    }
    /// Does this object have a revision with this content? Used by scan:
    /// git navigation restores old content — a match means no new content
    /// exists and nothing may be minted (R18).
    pub fn revision_by_content(
        &self,
        object: &ObjectId,
        content_hash: &super::types::ContentHash,
    ) -> Result<Option<RevisionId>, String> {
        let rev: Option<String> = self
            .conn
            .query_row(
                "SELECT revision FROM revisions WHERE object = ?1 AND content_hash = ?2 ORDER BY revision LIMIT 1",
                rusqlite::params![object.0.to_string(), content_hash.as_str()],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        rev.map(|r| RevisionId::parse(&r)).transpose()
    }
}
