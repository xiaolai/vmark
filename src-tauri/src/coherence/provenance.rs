//! Human-edit provenance (WI-3.1; design-3.md D1, spec §5.4.1a rev 2).
//! Proposals are computed, never stored: the prior-input-set heuristic
//! walks the head's ancestry for the most recent transformation that
//! carried inputs, preserving roles (R24). Confirmation is the sole
//! re-emitting transformation — fresh entry/txf/idem, exact head match,
//! no resolution transfer. Everything fails loud: multi-head, unknown
//! objects, stale heads.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::dag::Resolved;
use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId, RevisionId};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedInput {
    pub path: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    #[serde(skip)]
    pub object: ObjectId,
    pub path: String,
    /// The head the proposal is valid against (echo back on confirm).
    pub head: String,
    pub inputs: Vec<ProposedInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfirmInput {
    pub path: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfirmRequest {
    pub path: String,
    /// The head shown at proposal time — a moved head fails loud.
    pub head: String,
    pub inputs: Vec<ConfirmInput>,
    /// Minted once per logical confirmation by the caller; retries
    /// reuse it (spec §5.4.1a — never the original transformation's).
    #[serde(default)]
    pub idem: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReceipt {
    pub entry_id: Uuid,
}

fn object_by_path(kernel: &WorkspaceKernel, path: &str) -> Result<ObjectId, String> {
    kernel
        .index()
        .registry_state()?
        .object_at
        .get(path)
        .copied()
        .ok_or_else(|| format!("not a tracked object: {path}"))
}

fn single_head(kernel: &WorkspaceKernel, object: &ObjectId) -> Result<RevisionId, String> {
    match kernel.index().resolve_live(object)? {
        Resolved::Single(rev) => Ok(rev),
        Resolved::DivergedHeads => {
            Err("object has multiple live heads — resolve divergence first".into())
        }
        Resolved::UnknownPin | Resolved::Absent => Err("object is not resolvable".into()),
    }
}

/// D1.1: propose inputs for an object whose head has no live edges,
/// from the most recent ancestral transformation that carried inputs.
pub fn perform_propose_inputs(
    kernel: &mut WorkspaceKernel,
    path: &str,
) -> Result<Proposal, String> {
    let object = object_by_path(kernel, path)?;
    let head = single_head(kernel, &object)?;
    if kernel.index().has_live_edges(&object, &head)? {
        return Err(format!("{path} already has provenance at its head"));
    }
    let dag = kernel.index().load_dag()?;
    // Walk ancestry (nearest first): head's parents, breadth-first.
    let mut queue: std::collections::VecDeque<RevisionId> = dag
        .parents_of(&object, &head)
        .unwrap_or_default()
        .into_iter()
        .collect();
    let mut seen = std::collections::HashSet::new();
    let registry = kernel.index().registry_state()?;
    while let Some(rev) = queue.pop_front() {
        if !seen.insert(rev.clone()) {
            continue;
        }
        let inputs = kernel.index().inputs_recorded_at(&object, &rev)?;
        if !inputs.is_empty() {
            let proposed = inputs
                .into_iter()
                .map(|(upstream, role)| ProposedInput {
                    path: registry
                        .path_of
                        .get(&upstream)
                        .cloned()
                        .unwrap_or_else(|| upstream.0.to_string()),
                    role,
                })
                .collect();
            return Ok(Proposal {
                object,
                path: path.to_string(),
                head: head.as_str().to_string(),
                inputs: proposed,
            });
        }
        queue.extend(dag.parents_of(&object, &rev).unwrap_or_default());
    }
    Err(format!("{path} has no prior input set in its ancestry"))
}

/// D1.3: append the provenance-confirmation — re-emit the exact head
/// with the confirmed inputs pinned at current context resolution.
pub fn perform_confirm_inputs(
    kernel: &mut WorkspaceKernel,
    req: &ConfirmRequest,
    actor: &str,
) -> Result<ConfirmReceipt, String> {
    let object = object_by_path(kernel, &req.path)?;
    let head = single_head(kernel, &object)?;
    if head.as_str() != req.head {
        return Err("stale confirmation — re-propose against the current head".into());
    }
    if req.inputs.is_empty() {
        return Err("a confirmation needs at least one input".into());
    }
    let content_hash = kernel
        .index()
        .content_hash_of(&object, &head)?
        .ok_or("head has no content hash")?;
    let dag = kernel.index().load_dag()?;
    let parents = dag.parents_of(&object, &head).unwrap_or_default();

    let mut inputs = Vec::new();
    for input in &req.inputs {
        let upstream = object_by_path(kernel, &input.path)?;
        if upstream == object {
            return Err("an object cannot be its own confirmed input".into());
        }
        let pinned =
            single_head(kernel, &upstream).map_err(|e| format!("input {}: {e}", input.path))?;
        let role = match input.role.as_str() {
            "direct" => "direct",
            "contextual" => "contextual",
            other => return Err(format!("unknown input role: {other:?}")),
        };
        inputs.push(json!({
            "object": upstream.0.to_string(),
            "revision": pinned.as_str(),
            "role": role,
        }));
    }

    kernel.ensure_initialized()?;
    let body = json!({
        "inputs": inputs,
        "outputs": [ {
            "object": object.0.to_string(),
            "revision": head.as_str(),
            "content_hash": content_hash.as_str(),
            "parents": parents.iter().map(|p| p.as_str()).collect::<Vec<_>>(),
        } ],
        "agent": { "type": "human", "id": actor },
        "intent": { "kind": "provenance-confirmation",
                    "summary": format!("confirmed {} input(s)", req.inputs.len()) },
        "confidence": "inferred",
    });
    let mut env = Envelope::create("transformation", kernel.writer(), body);
    if let Some(idem) = req.idem {
        env.idem = idem; // caller-minted, reused verbatim on retry (§5.1)
    }
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    Ok(ConfirmReceipt { entry_id })
}

#[tauri::command]
pub async fn coherence_propose_inputs(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    path: String,
) -> Result<Proposal, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_propose_inputs(&mut kernel, &path)
}

#[tauri::command]
pub async fn coherence_confirm_inputs(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    request: ConfirmRequest,
) -> Result<ConfirmReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let actor = super::commands::actor_identity(&root);
    perform_confirm_inputs(&mut kernel, &request, &actor)
}

impl super::index::CoherenceIndex {
    /// Any edges recorded at exactly this (object, revision)? D1 gates
    /// proposals on the head having none.
    pub(super) fn has_live_edges(
        &self,
        object: &ObjectId,
        rev: &RevisionId,
    ) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM edges WHERE downstream = ?1 AND downstream_rev = ?2 LIMIT 1",
                rusqlite::params![object.0.to_string(), rev.as_str()],
                |_| Ok(()),
            )
            .map(|_| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other.to_string()),
            })
    }

    /// The input set recorded at (object, revision) by its most recent
    /// transformation (UUIDv7 txf ids are time-ordered), roles intact.
    pub(super) fn inputs_recorded_at(
        &self,
        object: &ObjectId,
        rev: &RevisionId,
    ) -> Result<Vec<(ObjectId, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT upstream, role FROM edges
                 WHERE downstream = ?1 AND downstream_rev = ?2
                   AND txf = (SELECT MAX(txf) FROM edges
                              WHERE downstream = ?1 AND downstream_rev = ?2)
                 ORDER BY input_idx",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![object.0.to_string(), rev.as_str()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (obj, role) = row.map_err(|e| e.to_string())?;
            out.push((
                ObjectId(Uuid::parse_str(&obj).map_err(|e| e.to_string())?),
                role,
            ));
        }
        Ok(out)
    }
}

#[cfg(test)]
#[path = "provenance.test.rs"]
mod tests;
