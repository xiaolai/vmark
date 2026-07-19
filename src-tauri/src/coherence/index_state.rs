//! Scan-owned derived state on the index (split from `index.rs` for the
//! file-size gate): absence, capture holds, disk-lag bookkeeping, and
//! the applied-entry counter. Same `CoherenceIndex`, second impl block.

use uuid::Uuid;

use super::dag::ContextView;
use super::index::CoherenceIndex;
use super::project::OriginEdge;
use super::types::{InputRole, ObjectId, RevisionId};

impl CoherenceIndex {
    /// Expected disk-lag hashes for a buffer-captured object (the disk
    /// legitimately holds pre-apply content until the next real save).
    pub fn set_disk_lag(
        &mut self,
        object: &ObjectId,
        hashes: &[super::types::ContentHash],
    ) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM disk_lag WHERE object = ?1",
                [object.0.to_string()],
            )
            .map_err(|e| e.to_string())?;
        for h in hashes {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO disk_lag (object, content_hash) VALUES (?1, ?2)",
                    rusqlite::params![object.0.to_string(), h.as_str()],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn clear_disk_lag(&mut self, object: &ObjectId) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM disk_lag WHERE object = ?1",
                [object.0.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn disk_lag_contains(
        &self,
        object: &ObjectId,
        hash: &super::types::ContentHash,
    ) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM disk_lag WHERE object = ?1 AND content_hash = ?2",
                rusqlite::params![object.0.to_string(), hash.as_str()],
                |_| Ok(()),
            )
            .map(|_| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other.to_string()),
            })
    }

    pub fn is_held(&self, object: &ObjectId) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM held WHERE object = ?1",
                [object.0.to_string()],
                |_| Ok(()),
            )
            .map(|_| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other.to_string()),
            })
    }

    /// Count of applied entries (cheap incremental-sync guard).
    pub fn applied_count(&self) -> Result<usize, String> {
        self.conn
            .query_row("SELECT COUNT(*) FROM applied", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    }

    /// Mark/unmark an object absent (file deleted; spec §9.4). Scan-owned
    /// derived state — no ledger entry, history stays intact.
    pub fn set_absent(&mut self, object: &ObjectId, absent: bool) -> Result<(), String> {
        let sql = if absent {
            "INSERT OR IGNORE INTO absent (object) VALUES (?1)"
        } else {
            "DELETE FROM absent WHERE object = ?1"
        };
        self.conn
            .execute(sql, [object.0.to_string()])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Content hash of a specific revision (scan compares disk vs head).
    pub fn content_hash_of(
        &self,
        object: &ObjectId,
        revision: &RevisionId,
    ) -> Result<Option<super::types::ContentHash>, String> {
        let hash: Option<String> = self
            .conn
            .query_row(
                "SELECT content_hash FROM revisions WHERE object = ?1 AND revision = ?2",
                rusqlite::params![object.0.to_string(), revision.as_str()],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        hash.map(|h| super::types::ContentHash::parse(&h))
            .transpose()
    }
    /// Look up one origin edge by its ledger coordinates (WI-1.9a).
    pub fn edge_by(&self, txf: &Uuid, input: u32) -> Result<Option<OriginEdge>, String> {
        let row = self
            .conn
            .query_row(
                "SELECT upstream, pinned, downstream, downstream_rev, role, edge_kind FROM edges WHERE txf = ?1 AND input_idx = ?2",
                rusqlite::params![txf.to_string(), input as i64],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, String>(5)?,
                    ))
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        let Some((up, pinned, down, down_rev, role, kind)) = row else {
            return Ok(None);
        };
        Ok(Some(OriginEdge {
            txf: *txf,
            input,
            upstream: ObjectId(Uuid::parse_str(&up).map_err(|e| e.to_string())?),
            pinned: RevisionId::parse(&pinned)?,
            downstream: ObjectId(Uuid::parse_str(&down).map_err(|e| e.to_string())?),
            downstream_rev: RevisionId::parse(&down_rev)?,
            role: if role == "direct" {
                InputRole::Direct
            } else {
                InputRole::Contextual
            },
            kind: super::edge_kind::OriginEdgeKind::parse(&kind),
        }))
    }

    /// Kernel-side selection resolution for one object in the all-live
    /// default context (WI-1.9a needs a single `resolved_against`).
    pub fn resolve_live(&self, object: &ObjectId) -> Result<super::dag::Resolved, String> {
        Ok(super::dag::resolve(
            &ContextView::all_live(),
            &self.load_dag()?,
            object,
        ))
    }
}
