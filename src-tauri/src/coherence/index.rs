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

use super::types::{Envelope, InputRole, ObjectId, TypedBody};

// v2: applied keyed by idem; edges.confidence; held/disk_lag tables.
// Any v1 index (pre-release dev/E2E artifacts only) wipes + rebuilds.
const SCHEMA_VERSION: i32 = 2;

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
  PRIMARY KEY (txf, input_idx, downstream, downstream_rev)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_by_upstream ON edges (upstream);
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
CREATE TABLE IF NOT EXISTS applied (idem TEXT PRIMARY KEY);
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
    pub fn apply_entry(&mut self, env: &Envelope) -> Result<(), String> {
        let typed = env
            .typed()
            .map_err(|e| format!("index apply on malformed entry: {e}"))?;
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        // Keyed by IDEM, not entry id (audit A4): a crash-recovery replay
        // carries the same idem with a fresh id and must not re-apply.
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO applied (idem) VALUES (?1)",
                [env.idem.to_string()],
            )
            .map_err(|e| e.to_string())?;
        if inserted == 0 {
            return Ok(()); // replay
        }
        match typed {
            TypedBody::Transformation(t) => {
                for o in &t.outputs {
                    tx.execute(
                        "INSERT OR IGNORE INTO revisions (object, revision, parents, content_hash) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![
                            o.object.0.to_string(),
                            o.revision.as_str(),
                            serde_json::to_string(&o.parents).map_err(|e| e.to_string())?,
                            o.content_hash.as_str()
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    // A new revision revives an absent object (file restored).
                    tx.execute(
                        "DELETE FROM absent WHERE object = ?1",
                        [o.object.0.to_string()],
                    )
                    .map_err(|e| e.to_string())?;
                    for (i, input) in t.inputs.iter().enumerate() {
                        tx.execute(
                            "INSERT OR IGNORE INTO edges (txf, input_idx, upstream, pinned, downstream, downstream_rev, role, confidence)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                            rusqlite::params![
                                env.id.to_string(),
                                i as i64,
                                input.object.0.to_string(),
                                input.revision.as_str(),
                                o.object.0.to_string(),
                                o.revision.as_str(),
                                match input.role {
                                    InputRole::Direct => "direct",
                                    InputRole::Contextual => "contextual",
                                },
                                match t.confidence {
                                    super::types::Confidence::Exact => "exact",
                                    super::types::Confidence::Inferred => "inferred",
                                    super::types::Confidence::Unknown => "unknown",
                                }
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
            TypedBody::Ratification(r) | TypedBody::Waiver(r) => {
                let kind = if env.kind == "ratification" {
                    "ratification"
                } else {
                    "waiver"
                };
                tx.execute(
                    "INSERT OR IGNORE INTO resolutions (entry_id, txf, input_idx, kind, resolved_against, time, expires)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        env.id.to_string(),
                        r.edge.txf.to_string(),
                        r.edge.input as i64,
                        kind,
                        r.resolved_against.as_str(),
                        env.time,
                        r.expires
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            TypedBody::ObjectRegistered(r) => {
                tx.execute(
                    "INSERT OR IGNORE INTO registry (entry_id, object, path, schema, time) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        env.id.to_string(),
                        r.object.0.to_string(),
                        r.path,
                        r.schema,
                        env.time
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => {} // navigation, diagnostics, preserved and unknown kinds
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// Full rebuild from a ledger read (R16 path). Crash-safe: the schema
    /// version is zeroed for the duration, so an interrupted rebuild
    /// reopens as needs_rebuild instead of masquerading as complete.
    pub fn rebuild_from(&mut self, entries: &[Envelope]) -> Result<(), String> {
        self.conn
            .pragma_update(None, "user_version", 0)
            .map_err(|e| e.to_string())?;
        // Ledger-derived tables only: `absent`/`held`/`disk_lag` are
        // scan-owned session state a rebuild must not forget (A12/A18).
        for table in ["revisions", "edges", "resolutions", "registry", "applied"] {
            self.conn
                .execute(&format!("DELETE FROM {table}"), [])
                .map_err(|e| e.to_string())?;
        }
        for e in entries {
            self.apply_entry(e)?;
        }
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
