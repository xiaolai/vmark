//! `content_server_slidev_export` writes only to the calling webview's
//! save-panel choice (`export_target`), like `export_pdf` and
//! `export_via_pandoc`: a path the webview merely names is refused before the
//! content server is asked to write anything. Driven through the IPC layer of a
//! mock app so the caller is a real webview label.
//! Loaded via `#[path] mod export_target_tests;` from `slidev_commands.rs`.

use super::*;
use crate::export_target::ExportTargets;
use crate::ipc_caller::{invoke_from, window};
use serde_json::json;
use tauri::Manager;

fn app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(ContentServerManager::new())
        .manage(ExportTargets::default())
        .invoke_handler(tauri::generate_handler![content_server_slidev_export])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

fn export(win: &tauri::WebviewWindow<tauri::test::MockRuntime>, output: &str) -> serde_json::Value {
    invoke_from(
        win,
        "content_server_slidev_export",
        json!({
            "workspaceRoot": "/ws",
            "deckPath": "/ws/deck.md",
            "format": "pdf",
            "outputPath": output,
        }),
    )
    .expect_err("no content server runs in the mock app")
}

#[test]
fn a_path_the_user_did_not_choose_is_refused_before_any_server_call() {
    let app = app();
    let win = window(&app, "main");
    let err = export(&win, "/Users/someone/.zshrc.pdf");
    assert_eq!(err["code"], "permission-denied", "{err}");
}

#[test]
fn a_choice_made_for_another_path_is_refused_and_spent() {
    let app = app();
    let win = window(&app, "main");
    let targets = app.state::<ExportTargets>();
    targets
        .record("main", "/Users/someone/talk.pdf".into())
        .expect("record");
    let err = export(&win, "/Users/someone/other.pdf");
    assert_eq!(err["code"], "permission-denied", "{err}");
    // The bent choice is withdrawn: the right path no longer passes either.
    let err = export(&win, "/Users/someone/talk.pdf");
    assert_eq!(err["code"], "permission-denied", "{err}");
}

#[test]
fn the_chosen_path_passes_the_claim_and_reaches_the_server_lookup() {
    let app = app();
    let win = window(&app, "main");
    app.state::<ExportTargets>()
        .record("main", "/Users/someone/talk.pdf".into())
        .expect("record");
    let err = export(&win, "/Users/someone/talk.pdf");
    // Past the claim, the next refusal is "no server for this workspace".
    assert_eq!(err["code"], "not-found", "{err}");
}

#[test]
fn a_choice_belongs_to_the_webview_that_made_it() {
    let app = app();
    let main = window(&app, "main");
    app.state::<ExportTargets>()
        .record("doc-2", "/Users/someone/talk.pdf".into())
        .expect("record");
    let err = export(&main, "/Users/someone/talk.pdf");
    assert_eq!(err["code"], "permission-denied", "{err}");
}
