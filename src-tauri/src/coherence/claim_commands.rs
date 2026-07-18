//! Claim lifecycle commands (WI-2b.2; design-2a.md D2, spec §5.4.5
//! revision 1). Service tier (ADR-C4): every act is an explicit human
//! action appending a `claim` entry with the recorded actor — the only
//! mutating surface until Phase 3's delegation model (D2.6). Scoping
//! (D2.4) edits context manifests, not the ledger — it is reversible
//! visibility, never retirement.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::claims::{ClaimStore, Maturity};
use super::contexts::{write_manifest, ContextManifest, ContextSet, DEFAULT_CONTEXT_ID};
use super::state::WorkspaceKernel;
use super::types::Envelope;

#[derive(Debug, Clone, Deserialize)]
pub struct ClaimRequest {
    /// `create` | `promote` | `correct` | `retire`.
    pub action: String,
    /// Stable claim id — required for every action except `create`.
    pub claim: Option<Uuid>,
    /// Required for `create` and `correct`.
    pub statement: Option<String>,
    /// `create` only; defaults to now (event time, RFC 3339).
    pub valid_at: Option<String>,
    /// `retire` only; defaults to now.
    pub invalid_at: Option<String>,
    /// `create` only: workspace-relative path of the source document —
    /// its object + current revision become `established_by`.
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaimReceipt {
    pub claim: Uuid,
    pub entry_id: Uuid,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn perform_claim(
    kernel: &mut WorkspaceKernel,
    req: &ClaimRequest,
    actor: &str,
) -> Result<ClaimReceipt, String> {
    let body = match req.action.as_str() {
        "create" => {
            let statement = req
                .statement
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or("create requires a non-empty statement")?;
            let source = req
                .source_path
                .as_deref()
                .ok_or("create requires source_path for provenance (D2.2)")?;
            let registry = kernel.index().registry_state()?;
            let object = *registry
                .object_at
                .get(source)
                .ok_or_else(|| format!("source_path is not a tracked object: {source}"))?;
            let revision = match kernel.index().resolve_live(&object)? {
                super::dag::Resolved::Single(rev) => rev,
                _ => {
                    return Err(format!(
                        "source object has no single live revision: {source}"
                    ))
                }
            };
            json!({
                "claim": Uuid::now_v7().to_string(),
                "statement": statement,
                "valid_at": req.valid_at.clone().unwrap_or_else(now_rfc3339),
                "invalid_at": null,
                "established_by": [ { "object": object.0.to_string(),
                                      "revision": revision.as_str() } ],
                "supersedes": null,
                "maturity": "draft",
                "actor": { "type": "human", "id": actor },
            })
        }
        "promote" | "correct" | "retire" => {
            let claim = req.claim.ok_or("this action requires a claim id")?;
            let read = kernel.ledger().read_all()?;
            let store = ClaimStore::from_entries(&read.entries);
            let current = store
                .current(claim)
                .ok_or_else(|| format!("unknown claim: {claim}"))?;
            match req.action.as_str() {
                "promote" => {
                    if current.maturity != Maturity::Draft {
                        return Err("only a draft claim can be promoted (D2.3)".into());
                    }
                    entry_body(
                        claim,
                        &current.statement,
                        "established",
                        None,
                        current,
                        actor,
                    )
                }
                "correct" => {
                    let statement = req
                        .statement
                        .as_deref()
                        .filter(|s| !s.trim().is_empty())
                        .ok_or("correct requires a non-empty statement")?;
                    entry_body(
                        claim,
                        statement,
                        maturity_str(current),
                        None,
                        current,
                        actor,
                    )
                }
                _retire => {
                    let invalid_at = req.invalid_at.clone().unwrap_or_else(now_rfc3339);
                    entry_body(
                        claim,
                        &current.statement,
                        maturity_str(current),
                        Some(invalid_at),
                        current,
                        actor,
                    )
                }
            }
        }
        other => return Err(format!("unknown claim action: {other:?}")),
    };

    kernel.ensure_initialized()?;
    let claim_id = Uuid::parse_str(body["claim"].as_str().unwrap_or_default())
        .map_err(|e| format!("claim id: {e}"))?;
    let env = Envelope::create("claim", kernel.writer(), body);
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    // D2.2: creation scopes the claim into the current context in the
    // same act. Scope failures surface — a claim invisible everywhere
    // right after creation would read as data loss.
    if req.action == "create" {
        perform_claim_scope(kernel, DEFAULT_CONTEXT_ID, claim_id, true)?;
    }
    Ok(ClaimReceipt {
        claim: claim_id,
        entry_id,
    })
}

fn maturity_str(e: &super::claims::ClaimEntry) -> &'static str {
    match e.maturity {
        Maturity::Draft => "draft",
        Maturity::Established => "established",
    }
}

fn entry_body(
    claim: Uuid,
    statement: &str,
    maturity: &str,
    invalid_at: Option<String>,
    current: &super::claims::ClaimEntry,
    actor: &str,
) -> serde_json::Value {
    json!({
        "claim": claim.to_string(),
        "statement": statement,
        "valid_at": null,
        "invalid_at": invalid_at,
        "established_by": [],
        "supersedes": current.entry_id.to_string(),
        "maturity": maturity,
        "actor": { "type": "human", "id": actor },
    })
}

/// D2.4: reversible visibility. Materializes `contexts/default.json`
/// for the implicit default context; any other context must exist.
pub fn perform_claim_scope(
    kernel: &mut WorkspaceKernel,
    context: Uuid,
    claim: Uuid,
    visible: bool,
) -> Result<(), String> {
    kernel.ensure_initialized()?;
    let dir = kernel.root().join(".vmark").join("contexts");
    let set = ContextSet::load(&dir);
    let mut manifest = match set.manifests.get(&context) {
        Some(m) => m.clone(),
        None if context == DEFAULT_CONTEXT_ID => ContextManifest {
            format: 0,
            id: DEFAULT_CONTEXT_ID,
            name: "default".into(),
            parent: None,
            selections: Default::default(),
            enforcement: Default::default(),
            visible_claims: Vec::new(),
            git_branch: None,
            extra: Default::default(),
        },
        None => return Err(format!("unknown context: {context}")),
    };
    if visible {
        if !manifest.visible_claims.contains(&claim) {
            manifest.visible_claims.push(claim);
        }
    } else {
        manifest.visible_claims.retain(|c| *c != claim);
    }
    write_manifest(&dir, &manifest)
}

/// One row of the current-claims listing (UI + read-only MCP).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRow {
    pub claim: Uuid,
    pub entry_id: Uuid,
    pub statement: String,
    pub maturity: String,
    pub invalid_at: Option<String>,
    /// Visible in the default context (D2.4 — the v1 UI surface).
    pub visible: bool,
}

pub fn perform_claims_list(kernel: &mut WorkspaceKernel) -> Result<Vec<ClaimRow>, String> {
    let read = kernel.ledger().read_all()?;
    let store = ClaimStore::from_entries(&read.entries);
    let contexts = ContextSet::load(&kernel.root().join(".vmark").join("contexts"));
    let visible_set = contexts.effective_claims(DEFAULT_CONTEXT_ID);
    Ok(store
        .all_current()
        .into_iter()
        .map(|e| ClaimRow {
            claim: e.claim,
            entry_id: e.entry_id,
            statement: e.statement.clone(),
            maturity: maturity_str(e).to_string(),
            invalid_at: e.invalid_at.clone(),
            visible: visible_set.contains(&e.claim),
        })
        .collect())
}

#[tauri::command]
pub async fn coherence_claim(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    request: ClaimRequest,
) -> Result<ClaimReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let actor = super::commands::actor_identity(&root);
    perform_claim(&mut kernel, &request, &actor)
}

#[tauri::command]
pub async fn coherence_claim_scope(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    context: Uuid,
    claim: Uuid,
    visible: bool,
) -> Result<(), String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_claim_scope(&mut kernel, context, claim, visible)
}

#[tauri::command]
pub async fn coherence_claims(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<ClaimRow>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_claims_list(&mut kernel)
}

#[cfg(test)]
#[path = "claim_commands.test.rs"]
mod tests;
