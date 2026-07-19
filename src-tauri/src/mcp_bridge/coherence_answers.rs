//! The `vmark.coherence.*` Rust-terminal answers (WI-1.10 + WI-2b.8),
//! split from `routing.rs` for the file-size gate. Read-only: status,
//! edges, claims, contexts — all answered from the managed kernel.

use super::types::McpResponse;
use crate::coherence::claim_commands::perform_claims_list;
use crate::coherence::commands::{
    perform_breakdown, perform_resolve_as, perform_status, CoherenceState, ResolveRequest,
};
use crate::coherence::context_commands::perform_contexts_list;
use crate::coherence::delegation::DelegationStore;
use tauri::Runtime;

/// Answer a `vmark.coherence.*` read request from the managed kernel state.
///
/// Factored out of `handle_rust_side` so it can be tested without a mock
/// Tauri app. Never panics: every failure (missing/invalid workspace_root,
/// kernel open failure, poisoned lock) becomes `success: false` with the
/// error string.
/// Whether `root` is a workspace this installation has opened (its config
/// marker exists) — the coherence tool's root allow-list (audit C1).
pub(super) fn is_known_workspace<R: Runtime>(app: &tauri::AppHandle<R>, root: &str) -> bool {
    use tauri::Manager;
    let Ok(ws_dir) = app.path().app_data_dir().map(|d| d.join("workspaces")) else {
        return false;
    };
    ws_dir
        .join(format!("{}.json", crate::workspace::hash_root_path(root)))
        .exists()
        || ws_dir
            .join(format!(
                "{}.json",
                crate::workspace::legacy_hash_root_path(root)
            ))
            .exists()
}

pub(super) fn answer_coherence(
    state: &CoherenceState,
    request_type: &str,
    args: &serde_json::Value,
    principal: Option<&str>,
) -> McpResponse {
    match answer_coherence_inner(state, request_type, args, principal) {
        Ok(data) => McpResponse {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(e) => McpResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

fn answer_coherence_inner(
    state: &CoherenceState,
    request_type: &str,
    args: &serde_json::Value,
    principal: Option<&str>,
) -> Result<serde_json::Value, String> {
    let root = args.get("workspace_root").and_then(|v| v.as_str()).ok_or(
        "workspace_root (string) is required — the absolute path of the workspace to query",
    )?;
    let root = std::path::Path::new(root);
    if !root.is_absolute() {
        return Err(format!(
            "workspace_root must be an absolute path, got: {}",
            root.display()
        ));
    }
    if !root.is_dir() {
        return Err(format!(
            "workspace_root is not an accessible directory: {}",
            root.display()
        ));
    }
    let kernel = state.registry.kernel_for(root, state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    match request_type {
        "vmark.coherence.status" => {
            let status = perform_status(&mut kernel)?;
            serde_json::to_value(status).map_err(|e| format!("serialize status: {e}"))
        }
        "vmark.coherence.edges" => {
            let rows = perform_breakdown(&mut kernel)?;
            serde_json::to_value(rows).map_err(|e| format!("serialize edges: {e}"))
        }
        // WI-2b.8: read-only semantic-layer views (R23 intact — no
        // mutation reaches MCP before Phase 3's delegation model).
        "vmark.coherence.claims" => {
            let rows = perform_claims_list(&mut kernel)?;
            serde_json::to_value(rows).map_err(|e| format!("serialize claims: {e}"))
        }
        "vmark.coherence.contexts" => {
            let rows = perform_contexts_list(&mut kernel)?;
            serde_json::to_value(rows).map_err(|e| format!("serialize contexts: {e}"))
        }
        // WI-3.5 (D2.4): the ONE mutating action — authorized by a live
        // delegation bound to the AUTHENTICATED bridge principal, never
        // a caller-supplied identity. Fail closed on everything.
        "vmark.coherence.resolve" => {
            let principal =
                principal.ok_or("unidentified client — identify to the bridge before resolving")?;
            let txf = args
                .get("txf")
                .and_then(|v| v.as_str())
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .ok_or("txf (uuid) is required")?;
            let input = args
                .get("input")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok())
                .ok_or("input must be a number in the u32 range")?;
            let resolution = args
                .get("resolution")
                .and_then(|v| v.as_str())
                .ok_or("resolution is required: accept-newer | waive")?;
            let scope = format!("resolve.{resolution}");
            let reason = args
                .get("reason")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let read = kernel.ledger().read_all()?;
            let store = DelegationStore::from_entries(&read.entries);
            // The audit reference is the STABLE grant id, not the current
            // entry id — so "which resolutions did grant G authorize?"
            // resolves across G's whole supersession chain (audit A7).
            let grant = store
                .live_delegation_for(principal, &scope, &now)
                .ok_or_else(|| format!("no live delegation authorizes {principal:?} for {scope}"))?
                .grant;
            // D2.4: only LIVE edges are resolvable — the current
            // breakdown is the definition of live.
            let live = perform_breakdown(&mut kernel)?
                .iter()
                .any(|r| r.txf == txf && r.input == input);
            if !live {
                return Err("edge is not live (historical, fresh, or suppressed)".into());
            }
            let receipt = perform_resolve_as(
                &mut kernel,
                &ResolveRequest {
                    action: resolution.to_string(),
                    txf,
                    input,
                    reason,
                    expires: None,
                },
                &serde_json::json!({ "type": "agent", "id": principal }),
                Some(grant),
            )?;
            serde_json::to_value(receipt).map_err(|e| format!("serialize receipt: {e}"))
        }
        other => Err(format!("unknown coherence request type: {other}")),
    }
}
