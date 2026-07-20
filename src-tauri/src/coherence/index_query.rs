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

pub use super::index_row::{state_label, EdgeRow, RegistryState};

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
    /// Ordered by PARSED time (audit R21: lexical TEXT ordering breaks on
    /// mixed precision or offsets), entry id as the tiebreak.
    pub fn registry_state(&self) -> Result<RegistryState, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT object, path, schema, time, entry_id FROM registry")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut collected = Vec::new();
        for row in rows {
            let (obj, path, schema, time, entry_id) = row.map_err(|e| e.to_string())?;
            let parsed = chrono::DateTime::parse_from_rfc3339(&time).ok();
            collected.push((parsed, time, entry_id, obj, path, schema));
        }
        collected.sort_by(|a, b| (a.0, &a.1, &a.2).cmp(&(b.0, &b.1, &b.2)));
        let mut state = RegistryState::default();
        for (_, _, _, obj, path, schema) in collected {
            let object = ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?);
            state.upsert(object, path, schema); // ordered ⇒ last wins
        }
        Ok(state)
    }

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

    /// Latest path per object — derived from the parsed-time-ordered
    /// registry (audit A-M13: no lexical SQL time ordering anywhere).
    fn latest_paths(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let registry = self.registry_state()?;
        Ok(registry
            .path_of
            .into_iter()
            .map(|(object, path)| (object.0.to_string(), path))
            .collect())
    }

    /// All live, non-fresh direct edges in the all-live default context,
    /// projected by the pure kernel. Absent objects (deleted files) are
    /// hidden entirely (spec §9.4). Deterministic order.
    /// Default-context breakdown with an empty claim feed — the v1 UI
    /// surface. `breakdown_checked` is the context-aware form (D5.6).
    pub fn breakdown(&self, now: &str) -> Result<Vec<EdgeRow>, String> {
        self.breakdown_checked(
            now,
            "00000000-0000-0000-0000-000000000000",
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )
    }

    pub fn breakdown_checked(
        &self,
        now: &str,
        context: &str,
        fingerprint: &str,
    ) -> Result<Vec<EdgeRow>, String> {
        let dag = self.load_dag()?;
        let ctx = ContextView::all_live();
        let paths = self.latest_paths()?;
        let absent = self.absent_set()?;

        let mut stmt = self
            .conn
            .prepare("SELECT txf, input_idx, upstream, pinned, downstream, downstream_rev, role, confidence, edge_kind FROM edges")
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
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let all_resolutions = self.all_resolutions()?;
        let mut out = Vec::new();
        for row in edge_rows {
            let (txf, idx, up, pinned, down, down_rev, role, confidence, kind) =
                row.map_err(|e| e.to_string())?;
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
                kind: super::edge_kind::OriginEdgeKind::parse(&kind),
            };
            let resolutions = all_resolutions
                .get(&(edge.txf, edge.input))
                .cloned()
                .unwrap_or_default();
            let prior_waivers = resolutions
                .iter()
                .filter(|r| r.kind == ResolutionKind::Waiver)
                .count();
            let checks = self.live_checks(&edge.txf, edge.input, context, fingerprint)?;
            let Some(state) = project_edge(&edge, &ctx, &dag, &resolutions, &checks, now) else {
                continue;
            };
            if matches!(state, EdgeState::Fresh { .. }) {
                continue;
            }
            out.push(EdgeRow {
                txf: edge.txf,
                input: edge.input,
                prior_waivers,
                upstream_path: paths.get(&up).cloned(),
                upstream: edge.upstream,
                pinned: edge.pinned,
                downstream_path: paths.get(&down).cloned(),
                downstream: edge.downstream,
                downstream_rev: edge.downstream_rev,
                confidence,
                kind: edge.kind.as_str().into(),
                state,
                // Set by the breakdown surface from the lifecycle projection;
                // the index itself has no lifecycle knowledge.
                frozen_downstream: false,
                anchor_status: None,
            });
        }
        out.sort_by(|a, b| {
            (&a.downstream_path, a.txf, a.input).cmp(&(&b.downstream_path, b.txf, b.input))
        });
        Ok(out)
    }

    /// One query for every resolution, grouped by edge (audit R17: a
    /// per-edge query is O(edges) round-trips at §10 scale). `pub(super)` so the
    /// candidate preview (`preview.rs`) can project the affected edges' states.
    pub(super) fn all_resolutions(
        &self,
    ) -> Result<std::collections::HashMap<(Uuid, u32), Vec<EdgeResolution>>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT txf, input_idx, entry_id, kind, resolved_against, time, expires FROM resolutions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut map: std::collections::HashMap<(Uuid, u32), Vec<EdgeResolution>> =
            std::collections::HashMap::new();
        for row in rows {
            let (txf, input, id, kind, against, time, expires) = row.map_err(|e| e.to_string())?;
            map.entry((
                Uuid::parse_str(&txf).map_err(|e| e.to_string())?,
                input as u32,
            ))
            .or_default()
            .push(EdgeResolution {
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
        Ok(map)
    }
}
