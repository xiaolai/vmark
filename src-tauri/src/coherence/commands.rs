//! Tauri command surface (ADR-C4 services tier) + the resolution write
//! API (WI-1.9a). Commands are thin wrappers over testable free
//! functions; the MCP Rust-terminal routing calls the same functions
//! through managed state (WI-1.10) with no webview hop.

use serde_json::json;
use uuid::Uuid;

use super::capture::{capture, CaptureReceipt, CaptureRequest};
use super::dag::Resolved;
use super::index_query::EdgeRow;
use super::scan::{scan_workspace, ScanReport};
use super::state::{KernelRegistry, WorkspaceKernel};
use super::types::WriterId;
use crate::ai_provider::build_command;

pub struct CoherenceState {
    pub registry: KernelRegistry,
    pub writer: WriterId,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ResolveRequest {
    /// "accept-newer" appends a ratification; "waive" appends a waiver.
    pub action: String,
    pub txf: Uuid,
    pub input: u32,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolveReceipt {
    pub entry_id: Uuid,
    pub kind: String,
    pub resolved_against: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CoherenceStatus {
    pub initialized: bool,
    pub objects: usize,
    pub open_items: usize,
    pub quarantined: usize,
    pub writer: WriterId,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// v1 actor identity (spec §5.4.3): git user.name, else OS username.
/// Never blank.
pub fn actor_identity(root: &std::path::Path) -> String {
    if let Ok(out) = build_command("git", &["config", "user.name"])
        .current_dir(root)
        .output()
    {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown-human".to_string())
}

/// The resolution write path (WI-1.9a): validates the edge, computes a
/// single `resolved_against` from the live selection (rejecting
/// multi-head per spec §9.2), and appends the append-only record (I5).
pub fn perform_resolve(
    kernel: &mut WorkspaceKernel,
    req: &ResolveRequest,
    actor: &str,
) -> Result<ResolveReceipt, String> {
    let kind = match req.action.as_str() {
        "accept-newer" => "ratification",
        "waive" => "waiver",
        other => return Err(format!("unknown resolve action: {other:?}")),
    };
    if kind == "waiver" && req.reason.as_deref().is_none_or(str::is_empty) {
        return Err("a waiver requires a reason (spec §5.4.3)".into());
    }
    let edge = kernel
        .index()
        .edge_by(&req.txf, req.input)?
        .ok_or_else(|| format!("no such edge: {}#{}", req.txf, req.input))?;
    let resolved_against = match kernel.index().resolve_live(&edge.upstream)? {
        Resolved::Single(rev) => rev,
        Resolved::DivergedHeads => {
            return Err(
                "upstream has multiple live heads — no single revision to resolve against \
                 (spec §9.2); revise or pin a head first"
                    .into(),
            )
        }
        Resolved::UnknownPin | Resolved::Absent => {
            return Err("upstream object is not resolvable in this context".into())
        }
    };
    kernel.ensure_initialized()?;
    let body = json!({
        "edge": { "txf": req.txf, "input": req.input },
        "upstream_object": edge.upstream,
        "pinned": edge.pinned,
        "resolved_against": resolved_against,
        "actor": { "type": "human", "id": actor },
        "reason": req.reason,
    });
    let env = super::types::Envelope::create(kind, kernel.writer(), body);
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    Ok(ResolveReceipt {
        entry_id,
        kind: kind.to_string(),
        resolved_against: resolved_against.as_str().to_string(),
    })
}

/// Pull-based breakdown (R15): reconcile, then project.
pub fn perform_breakdown(kernel: &mut WorkspaceKernel) -> Result<Vec<EdgeRow>, String> {
    scan_workspace(kernel)?;
    // D5.6: the v1 UI projects the implicit default context — check
    // liveness binds to its current claim snapshot.
    let read = kernel.ledger().read_all()?;
    let store = super::claims::ClaimStore::from_entries(&read.entries);
    let contexts =
        super::contexts::ContextSet::load(&kernel.root().join(".vmark").join("contexts"));
    let visible = contexts.effective_claims(super::contexts::DEFAULT_CONTEXT_ID);
    let fingerprint = store.claims_fingerprint(&visible);
    kernel.index().breakdown_checked(
        &now_rfc3339(),
        &super::contexts::DEFAULT_CONTEXT_ID.to_string(),
        &fingerprint,
    )
}

pub fn perform_status(kernel: &mut WorkspaceKernel) -> Result<CoherenceStatus, String> {
    let objects = kernel.index().registry_state()?.path_of.len();
    let open_items = if kernel.is_initialized() {
        kernel.index().breakdown(&now_rfc3339())?.len()
    } else {
        0
    };
    Ok(CoherenceStatus {
        initialized: kernel.is_initialized(),
        objects,
        open_items,
        quarantined: kernel.quarantined,
        writer: kernel.writer(),
    })
}

#[tauri::command]
pub async fn coherence_capture(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: CaptureRequest,
) -> Result<CaptureReceipt, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    capture(&mut kernel, request)
}

#[tauri::command]
pub async fn coherence_resolve(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: ResolveRequest,
) -> Result<ResolveReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state.registry.kernel_for(&root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let actor = actor_identity(&root);
    perform_resolve(&mut kernel, &request, &actor)
}

#[tauri::command]
pub async fn coherence_breakdown(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<Vec<EdgeRow>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_breakdown(&mut kernel)
}

#[tauri::command]
pub async fn coherence_status(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<CoherenceStatus, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_status(&mut kernel)
}

/// Read-time head lookup (audit T5): MCP reads pin the revision that was
/// actually served, so a later upstream edit cannot be misattributed as
/// the write's input. Null when the path is not a known single-headed
/// object.
#[tauri::command]
pub async fn coherence_head(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    let registry = kernel.index().registry_state()?;
    let Some(object) = registry.object_at.get(&path) else {
        return Ok(None);
    };
    let heads = kernel.index().heads(object)?;
    match heads.as_slice() {
        [only] => Ok(Some(json!({ "object": object, "revision": only }))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn coherence_scan(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<ScanReport, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    scan_workspace(&mut kernel)
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
