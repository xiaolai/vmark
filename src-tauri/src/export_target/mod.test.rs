//! Tests for `export_target/mod.rs` — the save-panel choices the export
//! commands may write to.
//!
//! The property under test: `export_pdf` / `export_via_pandoc` write only to
//! the path the user chose in a save panel shown for the SAME webview, once.
//! Pure — no runtime, no panel — so it runs on every platform.

use std::path::{Path, PathBuf};

use tauri_plugin_dialog::FilePath;
use tokio::sync::oneshot;

use super::{settle, ExportTargetKind, ExportTargets};
use crate::command_error::ErrorCode;

fn abs(name: &str) -> PathBuf {
    std::env::temp_dir().join("vmark-export-target").join(name)
}

fn s(path: &Path) -> String {
    path.to_str().expect("utf-8").to_owned()
}

fn picked(path: PathBuf) -> Result<Option<FilePath>, oneshot::error::RecvError> {
    Ok(Some(FilePath::Path(path)))
}

// -- What a recorded choice permits ---------------------------------------------

#[test]
fn the_chosen_path_is_accepted_once_for_the_webview_that_chose_it() {
    let targets = ExportTargets::default();
    let path = abs("report.pdf");
    targets.record("pdf-export", path.clone()).expect("record");

    targets
        .take("pdf-export", &s(&path))
        .expect("the chosen path");
    let again = targets.take("pdf-export", &s(&path)).expect_err("one-shot");
    assert_eq!(again.code(), ErrorCode::PermissionDenied);
}

#[test]
fn a_path_nobody_chose_is_refused() {
    let targets = ExportTargets::default();
    let err = targets
        .take("main", &s(&abs("anything.pdf")))
        .expect_err("no choice was made");
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
}

#[test]
fn another_webview_cannot_spend_a_choice() {
    let targets = ExportTargets::default();
    let path = abs("report.docx");
    targets.record("main", path.clone()).expect("record");

    let err = targets
        .take("doc-2", &s(&path))
        .expect_err("chosen for a different webview");
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    // ...and the owner's choice survives that attempt.
    targets.take("main", &s(&path)).expect("still the owner's");
}

#[test]
fn a_different_path_is_refused_and_burns_the_choice() {
    // Fail closed: a request that names anything else is a script, not the
    // dialog's own export, and the choice it tried to bend is withdrawn.
    let targets = ExportTargets::default();
    let path = abs("report.pdf");
    targets.record("pdf-export", path.clone()).expect("record");

    let err = targets
        .take("pdf-export", &s(&abs("elsewhere.pdf")))
        .expect_err("not the chosen path");
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    targets
        .take("pdf-export", &s(&path))
        .expect_err("the choice was withdrawn");
}

#[test]
fn a_later_choice_replaces_an_earlier_one() {
    let targets = ExportTargets::default();
    let first = abs("first.pdf");
    let second = abs("second.pdf");
    targets.record("pdf-export", first.clone()).expect("record");
    targets
        .record("pdf-export", second.clone())
        .expect("record");

    targets
        .take("pdf-export", &s(&first))
        .expect_err("superseded");
    targets
        .record("pdf-export", second.clone())
        .expect("record");
    targets
        .take("pdf-export", &s(&second))
        .expect("the latest choice");
}

// -- What the panel's answer becomes ---------------------------------------------

#[test]
fn a_pdf_choice_without_the_extension_gains_it_and_that_is_what_is_recorded() {
    // The panel shows no filter (macOS Tahoe rejects typed input under one),
    // so a bare name comes back bare. The `.pdf` is added HERE, where the
    // choice is recorded, so the path returned is the path permitted.
    let targets = ExportTargets::default();
    let returned = settle(
        &targets,
        "pdf-export",
        ExportTargetKind::Pdf,
        picked(abs("report")),
    )
    .expect("settled")
    .expect("a path");
    assert_eq!(returned, s(&abs("report.pdf")));
    targets
        .take("pdf-export", &returned)
        .expect("returned == recorded");
}

#[test]
fn a_pdf_choice_that_already_ends_in_pdf_is_kept_in_any_case() {
    let targets = ExportTargets::default();
    let returned = settle(
        &targets,
        "pdf-export",
        ExportTargetKind::Pdf,
        picked(abs("Report.PDF")),
    )
    .expect("settled")
    .expect("a path");
    assert_eq!(returned, s(&abs("Report.PDF")));
}

#[test]
fn a_pandoc_choice_is_recorded_exactly_as_picked() {
    // The format comes from the extension, which `export_via_pandoc` checks
    // against its allowlist; the picker does not rewrite it.
    let targets = ExportTargets::default();
    let returned = settle(
        &targets,
        "main",
        ExportTargetKind::Pandoc,
        picked(abs("notes.docx")),
    )
    .expect("settled")
    .expect("a path");
    assert_eq!(returned, s(&abs("notes.docx")));
    targets.take("main", &returned).expect("recorded");
}

#[test]
fn a_cancel_records_nothing() {
    let targets = ExportTargets::default();
    let returned = settle(&targets, "main", ExportTargetKind::Pandoc, Ok(None)).expect("settled");
    assert_eq!(returned, None);
    targets
        .take("main", &s(&abs("notes.docx")))
        .expect_err("nothing was chosen");
}

#[test]
fn a_dropped_dialog_is_an_internal_error_not_a_cancel() {
    let targets = ExportTargets::default();
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();
    drop(tx);
    let answer = tauri::async_runtime::block_on(rx);
    let err = settle(&targets, "main", ExportTargetKind::Pdf, answer).expect_err("no answer");
    assert_eq!(err.code(), ErrorCode::Internal);
}

#[test]
fn a_relative_answer_is_refused() {
    let targets = ExportTargets::default();
    let err = settle(
        &targets,
        "main",
        ExportTargetKind::Pandoc,
        picked(PathBuf::from("notes.docx")),
    )
    .expect_err("relative");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}

// -- `claim`, the call both export commands make -----------------------------------

#[cfg(not(target_os = "windows"))]
mod through_the_app {
    use tauri::Manager;

    use super::{abs, s};
    use crate::command_error::ErrorCode;
    use crate::export_target::{claim, ExportTargets};

    #[test]
    fn claim_spends_the_managed_choice() {
        let app = tauri::test::mock_builder()
            .manage(ExportTargets::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let path = abs("claimed.pdf");
        app.state::<ExportTargets>()
            .record("pdf-export", path.clone())
            .expect("record");

        claim(app.handle(), "pdf-export", &s(&path)).expect("chosen");
        let err = claim(app.handle(), "pdf-export", &s(&path)).expect_err("spent");
        assert_eq!(err.code(), ErrorCode::PermissionDenied);
    }

    #[test]
    fn claim_without_the_registry_fails_loud() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let err = claim(app.handle(), "main", &s(&abs("x.pdf"))).expect_err("unmanaged");
        assert_eq!(err.code(), ErrorCode::Internal);
    }
}
