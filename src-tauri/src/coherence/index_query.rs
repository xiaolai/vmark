//! Read-side queries of the SQLite index (ADR-C4 storage tier), split
//! from `index.rs` for the file-size gate. Same `CoherenceIndex` — this
//! file adds the query `impl` block: DAG loading, head sets, registry
//! state, and the breakdown projection (pure-kernel `project_edge`, so
//! staleness has exactly one implementation).

use uuid::Uuid;

use super::dag::{ContextView, RevisionDag};
use super::index::CoherenceIndex;
use super::project::{project_edge, EdgeResolution, EdgeState, OriginEdge, ResolutionKind};
use super::types::{InputRole, ObjectId, RevisionId};

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

impl CoherenceIndex {
    fn absent_set(&self) -> Result<std::collections::HashSet<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT object FROM absent")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Latest registered (object → path) map and its reverse, plus schema.
    pub fn registry_state(&self) -> Result<RegistryState, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT object, path, schema FROM registry ORDER BY time ASC, entry_id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut state = RegistryState::default();
        for row in rows {
            let (obj, path, schema) = row.map_err(|e| e.to_string())?;
            let object = ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?);
            state.upsert(object, path, schema); // ordered ⇒ last wins
        }
        Ok(state)
    }

    fn load_dag(&self) -> Result<RevisionDag, String> {
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
    /// projected by the pure kernel. Absent objects (deleted files) are
    /// hidden entirely (spec §9.4). Deterministic order.
    pub fn breakdown(&self, now: &str) -> Result<Vec<EdgeRow>, String> {
        let dag = self.load_dag()?;
        let ctx = ContextView::all_live();
        let paths = self.latest_paths()?;
        let absent = self.absent_set()?;

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
            if absent.contains(&up) || absent.contains(&down) {
                continue;
            }
            let edge = OriginEdge {
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

    /// Look up one origin edge by its ledger coordinates (WI-1.9a).
    pub fn edge_by(&self, txf: &Uuid, input: u32) -> Result<Option<OriginEdge>, String> {
        let row = self
            .conn
            .query_row(
                "SELECT upstream, pinned, downstream, downstream_rev, role FROM edges WHERE txf = ?1 AND input_idx = ?2",
                rusqlite::params![txf.to_string(), input as i64],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        let Some((up, pinned, down, down_rev, role)) = row else {
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

/// Latest registered identity data per object (spec §5.4.6 chain, last
/// (time, id) wins) — what scan and capture consult.
#[derive(Debug, Default, Clone)]
pub struct RegistryState {
    pub path_of: std::collections::HashMap<ObjectId, String>,
    pub object_at: std::collections::HashMap<String, ObjectId>,
    pub schema_of: std::collections::HashMap<ObjectId, Option<String>>,
}

impl RegistryState {
    fn upsert(&mut self, object: ObjectId, path: String, schema: Option<String>) {
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
