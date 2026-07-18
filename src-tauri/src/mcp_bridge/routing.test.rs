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

    let response = answer_coherence(&state, "vmark.coherence.status", &args);

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

    let response = answer_coherence(&state, "vmark.coherence.edges", &args);

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
        let response = answer_coherence(&state, "vmark.coherence.status", &args);
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

    let response = answer_coherence(&state, "vmark.coherence.edges", &args);

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

    let response = answer_coherence(&state, "vmark.coherence.status", &args);

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

    let response = answer_coherence(&state, "vmark.coherence.delete_all", &args);

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

    let response = handle_rust_side(&request, app.handle()).expect("answered in Rust");

    assert!(response.success, "error: {:?}", response.error);
    assert_eq!(
        response.data.expect("status payload")["initialized"],
        serde_json::json!(false)
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

    let response = handle_rust_side(&request, app.handle()).expect("answered in Rust");

    assert!(response.success, "error: {:?}", response.error);
    assert_eq!(response.data, Some(serde_json::json!([])));
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

    let response = handle_rust_side(&request, app.handle()).expect("still answered in Rust");

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

    assert!(handle_rust_side(&request, app.handle()).is_none());
}
