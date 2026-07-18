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
use uuid::Uuid;

use super::dag::{ContextView, RevisionDag};
use super::project::{
    project_edge, EdgeResolution, EdgeState, OriginEdge, ResolutionKind,
};
use super::types::{Envelope, InputRole, ObjectId, RevisionId, TypedBody};

const SCHEMA_VERSION: i32 = 1;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS revisions (
  object TEXT NOT NULL, revision TEXT NOT NULL, parents TEXT NOT NULL,
  PRIMARY KEY (object, revision)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edges (
  txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
  upstream TEXT NOT NULL, pinned TEXT NOT NULL,
  downstream TEXT NOT NULL, downstream_rev TEXT NOT NULL,
  role TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS applied (entry_id TEXT PRIMARY KEY);
";

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
    #[serde(serialize_with = "serialize_state")]
    pub state: EdgeState,
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

pub struct CoherenceIndex {
    conn: Connection,
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
            for table in ["revisions", "edges", "resolutions", "registry", "applied"] {
                let _ = conn.execute(&format!("DROP TABLE IF EXISTS {table}"), []);
            }
        }
        conn.execute_batch(SCHEMA).map_err(|e| format!("index schema failed: {e}"))?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("index version write failed: {e}"))?;
        Ok((Self { conn }, needs_rebuild))
    }

    /// Apply one ledger entry incrementally. Idempotent by entry id.
    pub fn apply_entry(&mut self, env: &Envelope) -> Result<(), String> {
        let typed = env.typed().map_err(|e| format!("index apply on malformed entry: {e}"))?;
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let inserted = tx
            .execute("INSERT OR IGNORE INTO applied (entry_id) VALUES (?1)", [env.id.to_string()])
            .map_err(|e| e.to_string())?;
        if inserted == 0 {
            return Ok(()); // replay
        }
        match typed {
            TypedBody::Transformation(t) => {
                for o in &t.outputs {
                    tx.execute(
                        "INSERT OR IGNORE INTO revisions (object, revision, parents) VALUES (?1, ?2, ?3)",
                        rusqlite::params![
                            o.object.0.to_string(),
                            o.revision.as_str(),
                            serde_json::to_string(&o.parents).map_err(|e| e.to_string())?
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    for (i, input) in t.inputs.iter().enumerate() {
                        tx.execute(
                            "INSERT OR IGNORE INTO edges (txf, input_idx, upstream, pinned, downstream, downstream_rev, role)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
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
                                }
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
            TypedBody::Ratification(r) | TypedBody::Waiver(r) => {
                let kind = if env.kind == "ratification" { "ratification" } else { "waiver" };
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

    /// Full rebuild from a ledger read (R16 path).
    pub fn rebuild_from(&mut self, entries: &[Envelope]) -> Result<(), String> {
        for table in ["revisions", "edges", "resolutions", "registry", "applied"] {
            self.conn
                .execute(&format!("DELETE FROM {table}"), [])
                .map_err(|e| e.to_string())?;
        }
        for e in entries {
            self.apply_entry(e)?;
        }
        Ok(())
    }

    fn load_dag(&self) -> Result<RevisionDag, String> {
        let mut dag = RevisionDag::default();
        let mut stmt = self
            .conn
            .prepare("SELECT object, revision, parents FROM revisions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
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

    fn latest_paths(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT object, path FROM registry ORDER BY time ASC, entry_id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (obj, path) = row.map_err(|e| e.to_string())?;
            map.insert(obj, path); // last (largest time, id) wins
        }
        Ok(map)
    }

    /// All live, non-fresh direct edges in the all-live default context,
    /// projected by the pure kernel. Deterministic order.
    pub fn breakdown(&self, now: &str) -> Result<Vec<EdgeRow>, String> {
        let dag = self.load_dag()?;
        let ctx = ContextView::all_live();
        let paths = self.latest_paths()?;

        let mut stmt = self
            .conn
            .prepare("SELECT txf, input_idx, upstream, pinned, downstream, downstream_rev, role FROM edges")
            .map_err(|e| e.to_string())?;
        let edge_rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for row in edge_rows {
            let (txf, idx, up, pinned, down, down_rev, role) = row.map_err(|e| e.to_string())?;
            let edge = OriginEdge {
                txf: Uuid::parse_str(&txf).map_err(|e| e.to_string())?,
                input: idx as u32,
                upstream: ObjectId(Uuid::parse_str(&up).map_err(|e| e.to_string())?),
                pinned: RevisionId::parse(&pinned)?,
                downstream: ObjectId(Uuid::parse_str(&down).map_err(|e| e.to_string())?),
                downstream_rev: RevisionId::parse(&down_rev)?,
                role: if role == "direct" { InputRole::Direct } else { InputRole::Contextual },
            };
            let resolutions = self.resolutions_for(&edge.txf, edge.input)?;
            let Some(state) = project_edge(&edge, &ctx, &dag, &resolutions, &[], now) else {
                continue;
            };
            if matches!(state, EdgeState::Fresh { .. }) {
                continue;
            }
            out.push(EdgeRow {
                txf: edge.txf,
                input: edge.input,
                upstream_path: paths.get(&up).cloned(),
                upstream: edge.upstream,
                pinned: edge.pinned,
                downstream_path: paths.get(&down).cloned(),
                downstream: edge.downstream,
                downstream_rev: edge.downstream_rev,
                state,
            });
        }
        out.sort_by(|a, b| {
            (&a.downstream_path, a.txf, a.input).cmp(&(&b.downstream_path, b.txf, b.input))
        });
        Ok(out)
    }

    fn resolutions_for(&self, txf: &Uuid, input: u32) -> Result<Vec<EdgeResolution>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT entry_id, kind, resolved_against, time, expires FROM resolutions WHERE txf = ?1 AND input_idx = ?2")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![txf.to_string(), input as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (id, kind, against, time, expires) = row.map_err(|e| e.to_string())?;
            out.push(EdgeResolution {
                kind: if kind == "ratification" {
                    ResolutionKind::Ratification
                } else {
                    ResolutionKind::Waiver
                },
                resolved_against: RevisionId::parse(&against)?,
                time,
                id: Uuid::parse_str(&id).map_err(|e| e.to_string())?,
                expires,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
#[path = "index.test.rs"]
mod tests;
