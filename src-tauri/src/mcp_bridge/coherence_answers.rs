//! The `vmark.coherence.*` Rust-terminal answers (WI-1.10 + WI-2b.8),
//! split from `routing.rs` for the file-size gate. Read-only: status,
//! edges, claims, contexts — all answered from the managed kernel.

use super::types::McpResponse;
use crate::coherence::claim_commands::perform_claims_list;
use crate::coherence::commands::{perform_breakdown, perform_status, CoherenceState};
use crate::coherence::context_commands::perform_contexts_list;

/// Answer a `vmark.coherence.*` read request from the managed kernel state.
///
/// Factored out of `handle_rust_side` so it can be tested without a mock
/// Tauri app. Never panics: every failure (missing/invalid workspace_root,
/// kernel open failure, poisoned lock) becomes `success: false` with the
/// error string.
pub(super) fn answer_coherence(
    state: &CoherenceState,
    request_type: &str,
    args: &serde_json::Value,
) -> McpResponse {
    match answer_coherence_inner(state, request_type, args) {
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
        other => Err(format!("unknown coherence request type: {other}")),
    }
}
