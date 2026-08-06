//! SQLite index (ADR-C4 storage tier). Strictly derived (R16): deleting
//! `index.db` loses nothing; `rebuild_from` reproduces it from ledger
//! entries. Tables persist raw derived data (revisions, edges,
//! resolutions, registry, applied-entry ids); **projection semantics stay
//! in the pure kernel** (`dag`/`project`) — the index loads its tables
//! into a `RevisionDag` and calls `project_edge`, so staleness has one
//! implementation, not a SQL clone that can drift. Spike S2 measured the
//! full-scale cost of this shape (rebuild 1.34 s, breakdown ms-range at
//! §10 target scale), so the single-source-of-truth trade is free.
//! The schema is NOT public contract; `PRAGMA user_version` mismatch
//! wipes and requests a rescan (spec §12).

use std::path::Path;

use rusqlite::Connection;

use super::types::{Envelope, ObjectId};

// v2: applied keyed by idem; edges.confidence; held/disk_lag tables.
// v3: check_results table (WI-2b.3 — D5.6 context-snapshot liveness).
// v4: edges.edge_kind (Phase 2, ADR-P2 — additive, default 'dependency', so
//     every legacy edge reads as a dependency; format stays 0, spec §13.6);
//     edges_by_downstream index (Phase 3.0 bounded read-view, v4.4).
// v5: applied.entry_id (Phase 3.0 idem→receipt lookup, design v4.2 — the accept
//     retry returns the original entry, not just a dropped replay).
// Any older index wipes + rebuilds (derived, R16).
const SCHEMA_VERSION: i32 = 5;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS revisions (
  object TEXT NOT NULL, revision TEXT NOT NULL, parents TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (object, revision)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS absent (object TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS held (object TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS disk_lag (
  object TEXT NOT NULL, content_hash TEXT NOT NULL,
  PRIMARY KEY (object, content_hash)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS revisions_by_content ON revisions (object, content_hash);
CREATE TABLE IF NOT EXISTS edges (
  txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
  upstream TEXT NOT NULL, pinned TEXT NOT NULL,
  downstream TEXT NOT NULL, downstream_rev TEXT NOT NULL,
  role TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'exact',
  edge_kind TEXT NOT NULL DEFAULT 'dependency',
  PRIMARY KEY (txf, input_idx, downstream, downstream_rev)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_by_upstream ON edges (upstream);
-- Phase 3.0 (design v4.4): bounded preview reads the edges INCIDENT to a
-- changed object (upstream ∪ downstream), so downstream needs its own index.
CREATE INDEX IF NOT EXISTS edges_by_downstream ON edges (downstream);
CREATE TABLE IF NOT EXISTS resolutions (
  entry_id TEXT PRIMARY KEY, txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
  kind TEXT NOT NULL, resolved_against TEXT NOT NULL,
  time TEXT NOT NULL, expires TEXT
);
CREATE INDEX IF NOT EXISTS resolutions_by_edge ON resolutions (txf, input_idx);
CREATE TABLE IF NOT EXISTS registry (
  entry_id TEXT PRIMARY KEY, object TEXT NOT NULL, path TEXT NOT NULL,
  schema TEXT, time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applied (idem TEXT PRIMARY KEY, entry_id TEXT);
CREATE TABLE IF NOT EXISTS check_results (
  entry_id TEXT PRIMARY KEY, txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
  pinned TEXT NOT NULL, checked_against TEXT NOT NULL, verdict TEXT NOT NULL,
  time TEXT NOT NULL, context TEXT, claims_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS check_results_by_edge ON check_results (txf, input_idx);
";

pub struct CoherenceIndex {
    pub(super) conn: Connection,
}

impl CoherenceIndex {
    /// Open (or create) the index. Returns `(index, needs_rebuild)` —
    /// true when the database is fresh or its schema version mismatched
    /// (wiped, caller must rescan; spec §12).
    pub fn open(path: &Path) -> Result<(Self, bool), String> {
        let conn = Connection::open(path).map_err(|e| format!("index open failed: {e}"))?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<(Self, bool), String> {
        let conn = Connection::open_in_memory().map_err(|e| format!("index open failed: {e}"))?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<(Self, bool), String> {
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| format!("index version read failed: {e}"))?;
        // Fresh db (0) or mismatched schema: caller must rescan. A
        // mismatch additionally wipes old tables — silent reset, the
        // schema is not contract (R16, spec §12).
        let needs_rebuild = version != SCHEMA_VERSION;
        if needs_rebuild && version != 0 {
            // Version mismatch: FULL reset including session-state tables —
            // their shapes may have changed with the schema.
            for table in [
                "revisions",
                "edges",
                "resolutions",
                "registry",
                "applied",
                "absent",
                "held",
                "disk_lag",
                "check_results",
            ] {
                let _ = conn.execute(&format!("DROP TABLE IF EXISTS {table}"), []);
            }
        }
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("index schema failed: {e}"))?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("index version write failed: {e}"))?;
        Ok((Self { conn }, needs_rebuild))
    }

    /// Apply one ledger entry incrementally. Idempotent by entry id.
    ///
    /// Owns its own transaction, so a standalone apply is atomic and durable on
    /// its own. `rebuild_from` does NOT go through here — it owns one
    /// transaction for the whole replay and calls `apply_entry_to` directly,
    /// because a per-entry commit is a per-entry durable write and that made a
    /// rebuild ~17x slower than it needed to be on a realistic ledger.
    pub fn apply_entry(&mut self, env: &Envelope) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        super::index_apply::apply_entry_to(&tx, env)?;
        tx.commit().map_err(|e| e.to_string())
    }

    /// Full rebuild from a ledger read (R16 path). Crash-safe: the schema
    /// version is zeroed for the duration, so an interrupted rebuild
    /// reopens as needs_rebuild instead of masquerading as complete.
    pub fn rebuild_from(&mut self, entries: &[Envelope]) -> Result<(), String> {
        // Durable crash sentinel FIRST, outside the transaction: if we die
        // mid-rebuild, the next open must see version 0 and rebuild again.
        self.conn
            .pragma_update(None, "user_version", 0)
            .map_err(|e| e.to_string())?;
        // One RAII transaction for the whole replacement — an rusqlite
        // `Transaction`, not raw BEGIN/COMMIT: a failed COMMIT leaves the
        // transaction ACTIVE in SQLite, and a raw path would return that error
        // while still holding a write transaction open on a kernel that is
        // about to be poisoned but stays alive. Drop-rollback closes that,
        // including on panic.
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        // Ledger-derived tables only: `absent`/`held`/`disk_lag` are
        // scan-owned session state a rebuild must not forget (A12/A18).
        for table in [
            "revisions",
            "edges",
            "resolutions",
            "registry",
            "applied",
            "check_results",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(|e| e.to_string())?;
        }
        for e in entries {
            super::index_apply::apply_entry_to(&tx, e)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.conn
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Capture hold for duplicate-ID sets (spec §2.1). Scan-owned.
    pub fn set_held(&mut self, object: &ObjectId, held: bool) -> Result<(), String> {
        let sql = if held {
            "INSERT OR IGNORE INTO held (object) VALUES (?1)"
        } else {
            "DELETE FROM held WHERE object = ?1"
        };
        self.conn
            .execute(sql, [object.0.to_string()])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "index.test.rs"]
mod tests;
