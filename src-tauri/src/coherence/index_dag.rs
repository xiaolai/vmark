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
    /// Load the WHOLE workspace revision DAG.
    ///
    /// Cost is O(revisions) with a JSON `parents` parse per row, so this is a
    /// per-OPERATION call, never a per-item one. `heads()` is a thin wrapper
    /// over it, which makes `heads()` in a loop quadratic: the scan's per-file
    /// `heads()` call had a 300-file workspace loading ~360,000 rows to answer
    /// 300 lookups, and that was ~99% of a breakdown refresh (the read path
    /// runs a full scan before projecting). Callers that need heads for many
    /// objects must load this once and query the returned DAG.
    ///
    /// `scan_loads_the_revision_dag_once_per_scan` pins that structurally —
    /// the regression is invisible to any correctness test, since it returns
    /// identical results and only costs more.
    pub(super) fn load_dag(&self) -> Result<RevisionDag, String> {
        // Counted so a per-file regression is catchable structurally: this
        // reads EVERY revision in the workspace, which is fine once per
        // operation and quadratic once per file — and the two are
        // indistinguishable by results, only by cost.
        #[cfg(test)]
        self.load_dag_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
