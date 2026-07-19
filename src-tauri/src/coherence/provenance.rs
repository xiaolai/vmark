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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceCandidate {
    pub path: String,
    /// How many inputs the heuristic would propose (display hint).
    pub proposed: usize,
}

/// D1.5: the breakdown's "provenance unknown" group — every tracked
/// object whose head is orphaned but recoverable. Pull-only; objects
/// that never had inputs are not candidates (nothing to recover, no
/// nagging — R4).
pub fn perform_provenance_candidates(
    kernel: &mut WorkspaceKernel,
) -> Result<Vec<ProvenanceCandidate>, String> {
    let registry = kernel.index().registry_state()?;
    let mut paths: Vec<(ObjectId, String)> = registry
        .path_of
        .iter()
        .map(|(o, p)| (*o, p.clone()))
        .collect();
    paths.sort_by(|a, b| a.1.cmp(&b.1));
    let mut out = Vec::new();
    for (_object, path) in paths {
        if let Ok(proposal) = perform_propose_inputs(kernel, &path) {
            out.push(ProvenanceCandidate {
                path,
                proposed: proposal.inputs.len(),
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
#[path = "provenance.test.rs"]
mod tests;
