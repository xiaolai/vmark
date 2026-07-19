//! Tests for `routing.rs` (included via `#[path]`).
//!
//! WI-1.10 — the Rust-terminal coherence answers: `vmark.coherence.status`
//! and `vmark.coherence.edges` are answered from the managed kernel with
//! no webview hop. `answer_coherence` is tested directly (no mock app
//! needed); the `handle_rust_side` wiring is exercised through a
//! MockRuntime app with managed state.

use super::*;
use crate::coherence::types::WriterId;

fn coherence_state() -> CoherenceState {
    CoherenceState {
        registry: crate::coherence::state::KernelRegistry::default(),
        writer: WriterId(uuid::Uuid::from_u128(7)),
    }
}

// -- answer_coherence: success paths ----------------------------------------

#[test]
fn status_on_uninitialized_workspace_reports_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let args = serde_json::json!({ "workspace_root": dir.path() });

    let response = answer_coherence(&state, "vmark.coherence.status", &args, None);

    assert!(response.success, "error: {:?}", response.error);
    assert!(response.error.is_none());
    let data = response.data.expect("status payload");
    assert_eq!(data["initialized"], serde_json::json!(false));
    assert_eq!(data["objects"], serde_json::json!(0));
    assert_eq!(data["open_items"], serde_json::json!(0));
    assert_eq!(data["quarantined"], serde_json::json!(0));
    // WriterId is #[serde(transparent)] — a bare UUID string.
    assert_eq!(
        data["writer"],
        serde_json::json!(uuid::Uuid::from_u128(7).to_string())
    );
}

#[test]
fn edges_on_uninitialized_workspace_returns_empty_array() {
    let dir = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let args = serde_json::json!({ "workspace_root": dir.path() });

    let response = answer_coherence(&state, "vmark.coherence.edges", &args, None);

    assert!(response.success, "error: {:?}", response.error);
    assert_eq!(response.data, Some(serde_json::json!([])));
}

// -- answer_coherence: error paths (never panic) ----------------------------

#[test]
fn missing_workspace_root_is_clean_error() {
    let state = coherence_state();
    for args in [
        serde_json::json!({}),
        serde_json::json!({ "workspace_root": 42 }), // wrong type
        serde_json::json!({ "workspace_root": null }),
    ] {
        let response = answer_coherence(&state, "vmark.coherence.status", &args, None);
        assert!(!response.success);
        assert!(response.data.is_none());
        assert!(
            response
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("workspace_root"),
            "error should name the missing arg: {:?}",
            response.error
        );
    }
}

#[test]
fn nonexistent_workspace_root_is_clean_error() {
    let state = coherence_state();
    let args = serde_json::json!({ "workspace_root": "/nonexistent/path/that/does/not/exist" });

    let response = answer_coherence(&state, "vmark.coherence.edges", &args, None);

    assert!(!response.success);
    assert!(
        response
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("not an accessible directory"),
        "error: {:?}",
        response.error
    );
}

#[test]
fn file_workspace_root_is_clean_error() {
    // A path that exists but is a file, not a directory.
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("notes.md");
    std::fs::write(&file, "x").unwrap();
    let state = coherence_state();
    let args = serde_json::json!({ "workspace_root": file });

    let response = answer_coherence(&state, "vmark.coherence.status", &args, None);

    assert!(!response.success);
    assert!(response
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("not an accessible directory"));
}

#[test]
fn unknown_coherence_request_type_is_clean_error() {
    // Defensive: `handle_rust_side` only routes the two known types here,
    // but the helper must not panic if that invariant ever slips.
    let dir = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let args = serde_json::json!({ "workspace_root": dir.path() });

    let response = answer_coherence(&state, "vmark.coherence.delete_all", &args, None);

    assert!(!response.success);
    assert!(response
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("unknown coherence request type"));
}

// -- handle_rust_side wiring (MockRuntime; crashes at startup on Windows) ---

#[cfg(not(target_os = "windows"))]
fn mock_app_with_coherence() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(coherence_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[cfg(not(target_os = "windows"))]
#[test]
fn handle_rust_side_answers_coherence_status() {
    let app = mock_app_with_coherence();
    let dir = tempfile::tempdir().unwrap();
    let request = McpRequest {
        request_type: "vmark.coherence.status".to_string(),
        args: serde_json::json!({ "workspace_root": dir.path() }),
    };

    let response = handle_rust_side(&request, app.handle(), None).expect("answered in Rust");

    // Audit C1: arbitrary roots are refused — only workspaces this
    // installation has opened (config marker present) are queryable. The
    // success path is covered by the direct answer_coherence tests.
    assert!(!response.success);
    assert!(
        response
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("not a workspace"),
        "error: {:?}",
        response.error
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn handle_rust_side_answers_coherence_edges() {
    let app = mock_app_with_coherence();
    let dir = tempfile::tempdir().unwrap();
    let request = McpRequest {
        request_type: "vmark.coherence.edges".to_string(),
        args: serde_json::json!({ "workspace_root": dir.path() }),
    };

    let response = handle_rust_side(&request, app.handle(), None).expect("answered in Rust");

    assert!(!response.success, "unknown roots are refused (audit C1)");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn handle_rust_side_without_managed_state_errors_instead_of_panicking() {
    // No .manage(CoherenceState) — the arm must answer with an error
    // response, never fall through to the webview or panic.
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let request = McpRequest {
        request_type: "vmark.coherence.status".to_string(),
        args: serde_json::json!({ "workspace_root": "/tmp" }),
    };

    let response = handle_rust_side(&request, app.handle(), None).expect("still answered in Rust");

    assert!(!response.success);
    assert!(response
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("coherence state unavailable"));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn handle_rust_side_falls_through_for_unrelated_types() {
    let app = mock_app_with_coherence();
    let request = McpRequest {
        request_type: "vmark.document.read".to_string(),
        args: serde_json::json!({}),
    };

    assert!(handle_rust_side(&request, app.handle(), None).is_none());
}

// WI-2b.8 — the read-only semantic-layer views over MCP.
#[test]
fn claims_and_contexts_answer_read_only() {
    let td = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let root = td.path().to_string_lossy().into_owned();
    let args = serde_json::json!({ "workspace_root": root });

    let claims = answer_coherence(&state, "vmark.coherence.claims", &args, None);
    assert!(claims.success, "{:?}", claims.error);
    assert_eq!(claims.data.unwrap(), serde_json::json!([]));

    let contexts = answer_coherence(&state, "vmark.coherence.contexts", &args, None);
    assert!(contexts.success, "{:?}", contexts.error);
    let rows = contexts.data.unwrap();
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1, "implicit default always present");
    assert_eq!(rows[0]["name"], "default");
    assert_eq!(rows[0]["enforcement"], "greenhouse");
}

// ── WI-3.5: the delegated resolve — principal-bound, fail-closed ────────

fn stale_workspace(td: &tempfile::TempDir, state: &CoherenceState) -> (uuid::Uuid, u32) {
    use crate::coherence::capture::{capture, CaptureInputSpec, CaptureRequest};
    use crate::coherence::types::{Agent, AgentType, Confidence, InputRole, Intent};
    let kernel = state
        .registry
        .kernel_for(td.path(), state.writer)
        .expect("kernel");
    let mut kernel = kernel.lock().unwrap();
    let mut cap = |rel: &str, content: &str, inputs: Vec<CaptureInputSpec>| {
        std::fs::write(td.path().join(rel), content).unwrap();
        capture(
            &mut kernel,
            CaptureRequest {
                path: rel.into(),
                content: content.into(),
                inputs,
                agent: Agent {
                    kind: AgentType::Human,
                    id: Some("t".into()),
                },
                intent: Intent {
                    kind: "test".into(),
                    summary: "t".into(),
                    prompt_hash: None,
                },
                confidence: Confidence::Exact,
                rewrite_identity: true,
                idem: None,
            },
        )
        .unwrap();
    };
    cap("elena.md", "green\n", vec![]);
    cap(
        "scene.md",
        "derived\n",
        vec![CaptureInputSpec {
            path: Some("elena.md".into()),
            object_id: None,
            revision: None,
            role: InputRole::Direct,
        }],
    );
    cap("elena.md", "brown\n", vec![]);
    let rows = crate::coherence::commands::perform_breakdown(&mut kernel).unwrap();
    (rows[0].txf, rows[0].input)
}

fn grant_for(td: &tempfile::TempDir, state: &CoherenceState, principal: &str, scope: &str) {
    use crate::coherence::delegation::{perform_delegate, DelegateRequest};
    let kernel = state.registry.kernel_for(td.path(), state.writer).unwrap();
    let mut kernel = kernel.lock().unwrap();
    perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: principal.into(),
            scope: vec![scope.into()],
            expires: "2099-01-01T00:00:00Z".into(),
            revoke: None,
        },
        "xiaolai",
        "2026-07-19T00:00:00Z",
    )
    .unwrap();
}

#[test]
fn delegated_resolve_requires_principal_grant_and_live_edge() {
    let td = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let (txf, input) = stale_workspace(&td, &state);
    let root = td.path().to_string_lossy().into_owned();
    let args = serde_json::json!({
        "workspace_root": root, "txf": txf.to_string(), "input": input,
        "resolution": "accept-newer",
    });

    // No identity → refused.
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, None);
    assert!(!r.success);
    assert!(r.error.unwrap().contains("unidentified"));

    // Identified but no grant → refused.
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, Some("codex-cli"));
    assert!(!r.success);
    assert!(r.error.unwrap().contains("no live delegation"));

    // Granted for the OTHER scope → still refused.
    grant_for(&td, &state, "codex-cli", "resolve.waive");
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, Some("codex-cli"));
    assert!(!r.success);

    // Proper grant → the resolution lands with agent actor + audit ref.
    grant_for(&td, &state, "codex-cli", "resolve.accept-newer");
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, Some("codex-cli"));
    assert!(r.success, "{:?}", r.error);
    let kernel = state.registry.kernel_for(td.path(), state.writer).unwrap();
    let kernel = kernel.lock().unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    let res = entries.iter().find(|e| e.kind == "ratification").unwrap();
    assert_eq!(res.body["actor"]["type"], "agent");
    assert_eq!(res.body["actor"]["id"], "codex-cli");
    assert!(
        res.body["delegation"].is_string(),
        "audit reference present"
    );

    // The edge is now resolved — a second delegated resolve fails (not live).
    drop(kernel);
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, Some("codex-cli"));
    assert!(!r.success);
    assert!(r.error.unwrap().contains("not live"));
}

#[test]
fn delegated_waive_still_requires_a_reason() {
    let td = tempfile::tempdir().unwrap();
    let state = coherence_state();
    let (txf, input) = stale_workspace(&td, &state);
    grant_for(&td, &state, "codex-cli", "resolve.waive");
    let root = td.path().to_string_lossy().into_owned();
    let args = serde_json::json!({
        "workspace_root": root, "txf": txf.to_string(), "input": input,
        "resolution": "waive",
    });
    let r = answer_coherence(&state, "vmark.coherence.resolve", &args, Some("codex-cli"));
    assert!(!r.success, "waiver without reason must be refused");
}

// WI-3.9 (dogfood-caught regression): the resolve action must be in
// handle_rust_side's DISPATCH arm, not only reachable via a direct
// answer_coherence call. This test goes through the real dispatch so a
// dropped arm entry fails loudly. (The live session-4 resolve returned
// "coherence request failed to execute" because resolve was missing here.)
#[cfg(not(target_os = "windows"))]
#[test]
fn resolve_is_reachable_through_handle_rust_side_dispatch() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app");
    app.manage(coherence_state());
    // An unknown workspace root: the dispatch must reach the coherence arm
    // and return the allow-list refusal — NOT fall through to `_ => None`
    // (which surfaces to the client as "failed to execute").
    let req = McpRequest {
        request_type: "vmark.coherence.resolve".to_string(),
        args: serde_json::json!({
            "workspace_root": "/no/such/workspace",
            "txf": uuid::Uuid::now_v7().to_string(),
            "input": 0,
            "resolution": "accept-newer",
        }),
    };
    let response = handle_rust_side(&req, app.handle(), Some("codex-cli".into()));
    assert!(
        response.is_some(),
        "resolve must be dispatched, not fall through to None"
    );
    assert!(!response.unwrap().success, "unknown workspace is refused");
}
