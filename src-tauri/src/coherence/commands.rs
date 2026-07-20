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
    /// Guards against a CONCURRENT check sweep (found by dogfooding, 2026-07-20).
    /// The sweep deliberately drops the kernel lock across its provider calls, so
    /// two invocations both snapshot "not yet checked" and both spend on the SAME
    /// edges — observed as 9 check-results for 5 distinct edges, two runs offset
    /// by ~0.5s. That also fails the Phase-1 gate's "resumes without
    /// double-checking" metric. In-process only: two app instances are still a
    /// cross-process concern (the sweep cannot hold the workspace flock while an
    /// LLM call is outstanding).
    pub sweep_in_flight: std::sync::atomic::AtomicBool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ResolveRequest {
    /// "accept-newer" appends a ratification; "waive" appends a waiver.
    pub action: String,
    pub txf: Uuid,
    pub input: u32,
    #[serde(default)]
    pub reason: Option<String>,
    /// D3.2: optional waiver expiry (RFC 3339); projection treats an
    /// expired waiver as absent, the record stays in history.
    #[serde(default)]
    pub expires: Option<String>,
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
    perform_resolve_as(
        kernel,
        req,
        &serde_json::json!({ "type": "human", "id": actor }),
        None,
    )
}

/// WI-3.5 (D2.4): the actor-generic resolve — agent resolutions carry
/// the delegation reference (spec §5.4.3 rev 2 typed validation rejects
/// them without it).
pub fn perform_resolve_as(
    kernel: &mut WorkspaceKernel,
    req: &ResolveRequest,
    actor: &serde_json::Value,
    delegation: Option<uuid::Uuid>,
) -> Result<ResolveReceipt, String> {
    // R1 (7th-review 6R-1): read the edge's current resolution state → build the
    // resolution → append, atomic under the workspace lock.
    kernel.with_write_lock(|kernel| perform_resolve_as_locked(kernel, req, actor, delegation))
}

fn perform_resolve_as_locked(
    kernel: &mut WorkspaceKernel,
    req: &ResolveRequest,
    actor: &serde_json::Value,
    delegation: Option<uuid::Uuid>,
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
        "actor": actor,
        "reason": req.reason,
        "expires": req.expires,
    });
    let mut body = body;
    if let Some(grant_entry) = delegation {
        body["delegation"] = serde_json::json!(grant_entry.to_string());
    }
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
    // 8R-5: a poisoned kernel's index may be half-rebuilt — refuse to SERVE it,
    // not just to write to it.
    kernel.ensure_available()?;
    perform_breakdown_in(kernel, None)
}

/// Context-aware breakdown (WI-2b.7): project the given context (None =
/// the implicit default). Check liveness binds to THAT context's current
/// claim snapshot (D5.6).
pub fn perform_breakdown_in(
    kernel: &mut WorkspaceKernel,
    context: Option<uuid::Uuid>,
) -> Result<Vec<EdgeRow>, String> {
    scan_workspace(kernel)?;
    let context = context.unwrap_or(super::contexts::DEFAULT_CONTEXT_ID);
    let read = kernel.ledger().read_all()?;
    let store = super::claims::ClaimStore::from_entries(&read.entries);
    let contexts =
        super::contexts::ContextSet::load(&kernel.root().join(".vmark").join("contexts"));
    let visible = contexts.effective_claims(context);
    let fingerprint = store.claims_fingerprint(&visible);
    let lifecycle = super::lifecycle::LifecycleSet::from_entries(&read.entries);
    let mut rows =
        kernel
            .index()
            .breakdown_checked(&now_rfc3339(), &context.to_string(), &fingerprint)?;
    // Document lifecycle (design-lifecycle-and-anchors.md §A): a FROZEN
    // downstream is a finished record, so upstream movement cannot invalidate
    // it. Flag it rather than drop it — the edge stays visible in a collapsed
    // group, so the layer never silently ignores a dependency the owner might
    // revive, and `state` stays truthful about what the edge actually is.
    // Applied HERE, at the user-facing breakdown, and deliberately NOT inside
    // `project_edge`: that path also feeds the accept precondition, which asks
    // "did the affected set change structurally?" — a different question that
    // must not shift because someone marked a document finished.
    for row in &mut rows {
        row.frozen_downstream = lifecycle.is_frozen(&row.downstream);
    }
    // Section anchors (design-lifecycle-and-anchors.md §B): an anchored edge asks
    // "did the part I depend on change?" instead of "did the file change?". Only
    // ANCHORED edges cost a CAS read here, and anchoring is opt-in, so the common
    // path is untouched.
    let anchors = super::anchors::AnchorSet::from_entries(&read.entries);
    if !anchors.is_empty() {
        // Two passes so the row borrow and the kernel borrow never overlap:
        // compute every status first, then apply.
        let mut computed: Vec<(usize, String)> = Vec::new();
        for (i, row) in rows.iter().enumerate() {
            let Some(anchor) = anchors.get(&row.txf, row.input).cloned() else {
                continue;
            };
            // Compare against the upstream's CURRENT text — that is what the
            // staleness question is really about.
            let current = match kernel.index().resolve_live(&row.upstream)? {
                Resolved::Single(rev) => rev,
                // No single current revision: the anchor cannot be evaluated, and
                // guessing would be worse than leaving the edge as projected.
                _ => continue,
            };
            let upstream = row.upstream;
            let status = match super::check_commands::snapshot_text(kernel, &upstream, &current) {
                Ok(text) => super::anchors::evaluate(&anchor, &text),
                // An unreadable snapshot must never read as "unchanged" — that
                // would silently suppress a real change.
                Err(_) => super::anchors::AnchorStatus::Lost,
            };
            computed.push((i, status.label().to_string()));
        }
        for (i, status) in computed {
            rows[i].anchor_status = Some(status);
        }
    }
    Ok(rows)
}

pub fn perform_status(kernel: &mut WorkspaceKernel) -> Result<CoherenceStatus, String> {
    kernel.ensure_available()?; // 8R-5: never serve a half-rebuilt index
    let objects = kernel.index().registry_state()?.path_of.len();
    // `open_items` must agree with what the breakdown actually asks the owner
    // about, so it excludes frozen downstreams too. Counting them here would put
    // "5 open" on the badge while the list shows nothing to do — the same
    // status-disagrees-with-edges inconsistency the lifecycle work already had to
    // fix once.
    let open_items = if kernel.is_initialized() {
        // Count what the breakdown would actually ask about, so the badge can
        // never disagree with the list.
        perform_breakdown_in(kernel, None)?
            .iter()
            .filter(|r| {
                !r.frozen_downstream && r.anchor_status.as_deref() != Some("anchor-unchanged")
            })
            .count()
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
    context: Option<uuid::Uuid>,
) -> Result<Vec<EdgeRow>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_breakdown_in(&mut kernel, context)
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
    kernel.ensure_available()?; // 8R-5: never serve a half-rebuilt index
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
