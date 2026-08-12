//! Tests for `window_manager/commands.rs`.
//!
//! These commands mostly create real windows, which a mock runtime cannot do
//! meaningfully — so the coverage here is the branch that needs no window:
//! `close_window` against a label that names none.
//!
//! That branch matters for #1253. The frontend calls `close_window` as the last
//! step of the close flow and awaits it; if it can reject for a reason the
//! caller does not distinguish, a close can fail in a way that looks identical
//! to a hang. Pinning the error CODE (not its message text) is what lets the
//! caller tell "no such window" from a real failure.

// tauri::test::MockRuntime crashes the test binary at startup on
// windows-latest (STATUS_ENTRYPOINT_NOT_FOUND); the `test` feature of tauri is
// not enabled there (see the target-specific dev-dependency in Cargo.toml), so
// these are cfg-gated to match the other mock-runtime suites in this crate.
#![cfg(not(target_os = "windows"))]

use super::close_window;
use crate::command_error::ErrorCode;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[test]
fn close_window_reports_not_found_for_an_unknown_label() {
    let app = mock_app();

    let err = close_window(app.handle().clone(), "doc-does-not-exist".into())
        .expect_err("closing a label that names no window must fail");

    // The CODE is the contract — a caller branching on message text breaks the
    // day someone rewords it (see .claude/rules/50-codebase-conventions.md).
    assert_eq!(err.code(), ErrorCode::NotFound);
}

#[test]
fn close_window_error_names_the_label_for_diagnosis() {
    let app = mock_app();

    let err = close_window(app.handle().clone(), "doc-42".into())
        .expect_err("closing a label that names no window must fail");

    assert!(
        err.message().contains("doc-42"),
        "the error should name the label it could not find, got: {}",
        err.message()
    );
}
