//! Tests for `lib.rs` (included via `#[path]`).
//!
//! Guards the crate-root re-export surface left behind by the 2026-07
//! decomposition of `lib.rs`: legacy `crate::` call sites depend on these
//! re-exports, and because some consumers are platform-gated the exact set
//! must stay compilable on every target (an unconditional re-export whose
//! only user is macOS-gated is an unused-import clippy error on
//! Linux/Windows CI — the exact regression this pins).

use std::path::Path;

#[test]
fn is_openable_supported_is_reachable_at_crate_root() {
    // Cross-platform consumers (external_editor, window_manager path
    // validation) call this via `crate::` — the re-export must exist and
    // behave on every target this test runs on. The gate requires an
    // existing regular file, so probe with a real one.
    let dir = tempfile::tempdir().expect("tempdir");
    let md = dir.path().join("notes.md");
    std::fs::write(&md, "# hi").expect("write");
    assert!(crate::is_openable_supported(&md));
    assert!(!crate::is_openable_supported(Path::new("missing.md")));
    let zip = dir.path().join("archive.zip");
    std::fs::write(&zip, b"zip").expect("write");
    assert!(!crate::is_openable_supported(&zip));
}

#[cfg(target_os = "macos")]
#[test]
fn has_supported_extension_is_reachable_at_crate_root_on_macos() {
    // Sole consumer (quarantine sweep) is macOS-gated, so the re-export is
    // deliberately cfg(target_os = "macos") — see lib.rs.
    assert!(crate::has_supported_extension(Path::new("notes.md")));
    assert!(!crate::has_supported_extension(Path::new("archive.zip")));
}

#[test]
fn pending_file_open_is_constructible_at_crate_root() {
    let pending = crate::PendingFileOpen {
        path: "/tmp/a.md".to_string(),
        workspace_root: None,
    };
    assert_eq!(pending.path, "/tmp/a.md");
}

/// #357 — every backend state the shipped composition manages is reachable.
///
/// This is the one part of `run()` a test can hold: `generate_context!()` and
/// the real plugin set do not exist under MockRuntime, but `manage_state`
/// takes any builder. It is also the part that fails silently — a command
/// reads its state through `State<'_, T>` or `try_state::<T>()`, so a dropped
/// `.manage()` compiles, starts, and only fails when the user clicks. The
/// list is an IDENTITY list: adding a state means adding it here, and
/// deleting one fails until this is updated too.
#[cfg(not(target_os = "windows"))]
#[test]
fn manage_state_registers_every_backend_state() {
    use tauri::Manager;

    let app = crate::manage_state(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    macro_rules! managed {
        ($($t:ty),+ $(,)?) => {$(
            assert!(
                app.try_state::<$t>().is_some(),
                concat!(stringify!($t), " is not managed — every command reading it fails at runtime")
            );
        )+};
    }

    managed!(
        crate::workflow::state::WorkflowRunnerState,
        crate::ai_provider::cancel::AiPromptCancelRegistry,
        crate::mcp_bridge::McpBridgeState,
        crate::hot_exit::HotExitState,
        crate::content_server::ContentServerManager,
        crate::browser::surface::BrowserSurface,
        crate::window_status::WindowStatusRegistry,
        crate::pdf_export::export_gate::ExportGate,
        crate::trusted_html::TrustedHtmlState,
    );
}
