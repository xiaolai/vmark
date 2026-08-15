//! Tests for the trusted-HTML IPC surface (issue #1273).
//!
//! `state.rs` owns the rules and pins them directly. What is left to check here
//! is that each command is wired to the rule it claims — in particular:
//!
//! - `trusted_html_publish` cannot mint a grant, since that is the one command
//!   whose misuse would let a caller manufacture a servable origin the user
//!   never authorized; and
//! - `trusted_html_grant` attributes the grant to the window the RUNTIME
//!   supplies, not to anything the caller can set. That attribution is what
//!   makes window-scoped teardown correct rather than decorative.

// Matches the other mock-runtime suites in this crate: tauri's `test` feature
// is not enabled on windows-latest, where MockRuntime crashes at startup.
#![cfg(not(target_os = "windows"))]

use super::*;
use crate::command_error::ErrorCode;
use tauri::Manager;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(TrustedHtmlState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A real `Window` under the mock runtime, so the label the command reads is
/// the one the runtime assigned rather than a value the test invented.
fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
    label: &str,
) -> tauri::Window<tauri::test::MockRuntime> {
    tauri::webview::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::default())
        .build()
        .expect("build mock window")
        .as_ref()
        .window()
}

const DOC: &str = "<p>hi</p>";

#[test]
fn grant_then_publish_then_revoke_round_trips() {
    let app = mock_app();
    let win = window(&app, "doc-1");
    let state = app.state::<TrustedHtmlState>();

    let token = trusted_html_grant(win, state.clone(), DOC.into()).unwrap();
    assert_eq!(state.html(&token).as_deref(), Some(DOC));

    trusted_html_publish(state.clone(), token.clone(), "<p>v2</p>".into()).unwrap();
    assert_eq!(state.html(&token).as_deref(), Some("<p>v2</p>"));

    trusted_html_revoke(state.clone(), token.clone());
    assert_eq!(state.html(&token), None);
}

/// The security-relevant half: the owner recorded is the calling window, so a
/// window's teardown revokes exactly its own grants.
#[test]
fn a_grant_is_owned_by_the_calling_window() {
    let app = mock_app();
    let state = app.state::<TrustedHtmlState>();

    let a = trusted_html_grant(window(&app, "doc-1"), state.clone(), DOC.into()).unwrap();
    let b = trusted_html_grant(window(&app, "doc-2"), state.clone(), DOC.into()).unwrap();

    assert_eq!(state.revoke_window("doc-1"), 1);
    assert_eq!(state.html(&a), None);
    assert!(state.html(&b).is_some(), "doc-2's grant must survive");
}

#[test]
fn publish_cannot_manufacture_a_grant() {
    let app = mock_app();
    let state = app.state::<TrustedHtmlState>();

    let err = trusted_html_publish(state.clone(), "a".repeat(64), DOC.into()).unwrap_err();

    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(
        state.grant_count(),
        0,
        "no grant exists that the user did not make"
    );
}

#[test]
fn revoke_is_idempotent() {
    let app = mock_app();
    let win = window(&app, "doc-1");
    let state = app.state::<TrustedHtmlState>();

    let token = trusted_html_grant(win, state.clone(), DOC.into()).unwrap();
    trusted_html_revoke(state.clone(), token.clone());
    trusted_html_revoke(state.clone(), token.clone());

    assert_eq!(state.grant_count(), 0);
}

#[test]
fn grant_surfaces_the_size_refusal_as_a_typed_error() {
    let app = mock_app();
    let win = window(&app, "doc-1");
    let state = app.state::<TrustedHtmlState>();

    let err = trusted_html_grant(
        win,
        state.clone(),
        "x".repeat(super::super::state::MAX_DOC_BYTES + 1),
    )
    .unwrap_err();

    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.i18n_key().is_some(),
        "a refusal the user can trigger must be translatable"
    );
}
