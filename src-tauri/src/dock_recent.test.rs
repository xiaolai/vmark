//! WI-FL5.9 — `register_recent_document`'s two guards, in order.
//!
//! `NSDocumentController` may only be touched on the main thread, and libtest
//! runs every test on its own thread — which is exactly the condition the
//! guard exists for. `try_register_recent_document` returns each refusal
//! instead of logging it, so the path that must stop short of AppKit is an
//! assertable value. The module is `#[cfg(target_os = "macos")]` in `lib.rs`,
//! so this file only ever compiles there.

use super::{
    register_recent_document, try_register_recent_document, try_register_with, SkipReason,
};
use objc2::MainThreadMarker;

fn existing_file() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("notes.md");
    std::fs::write(&path, "# hi").expect("write");
    let path = path.to_str().expect("utf-8 path").to_string();
    (dir, path)
}

#[test]
fn a_missing_path_is_skipped_before_the_thread_is_even_checked() {
    // This runs off the main thread (see the next test), so a thread-first
    // order would report `NotMainThread` here. `PathMissing` proves the path
    // guard runs first: a bad path never reaches AppKit on ANY thread.
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone.md");
    assert_eq!(
        try_register_recent_document(missing.to_str().unwrap()),
        Err(SkipReason::PathMissing)
    );
}

#[test]
fn off_the_main_thread_an_existing_file_is_refused_not_registered() {
    assert!(
        MainThreadMarker::new().is_none(),
        "libtest runs each test on its own thread; on the main thread this test proves nothing"
    );
    let (_dir, path) = existing_file();
    assert_eq!(
        try_register_recent_document(&path),
        Err(SkipReason::NotMainThread)
    );
}

#[test]
fn the_logging_entry_point_returns_normally_on_every_refusal() {
    // `register_dock_recent` dispatches this onto the main thread; a panic on
    // a refusal would take the event loop with it. Every skip logs and returns.
    let (_dir, path) = existing_file();
    register_recent_document(&path);
    register_recent_document("/definitely/not/here.md");
    let dir = tempfile::tempdir().expect("tempdir");
    register_recent_document(dir.path().to_str().unwrap());
}

// -- #138: a document is a regular FILE -------------------------------------

#[test]
fn a_directory_is_refused_as_not_a_file_before_the_thread_check() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert_eq!(
        try_register_recent_document(dir.path().to_str().unwrap()),
        Err(SkipReason::NotAFile)
    );
}

// -- #137: the command's own typed refusals ----------------------------------

#[test]
fn the_command_side_check_types_a_missing_path_and_a_non_file() {
    use super::check_document_path;
    use crate::command_error::ErrorCode;
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone.md");
    assert_eq!(
        check_document_path(missing.to_str().unwrap())
            .expect_err("missing")
            .code(),
        ErrorCode::NotFound
    );
    assert_eq!(
        check_document_path(dir.path().to_str().unwrap())
            .expect_err("a directory")
            .code(),
        ErrorCode::InvalidInput
    );
    let (_dir, path) = existing_file();
    check_document_path(&path).expect("a regular file passes");
}

// #335 — a stat that failed for a reason OTHER than absence keeps that reason.
// Reporting a permission failure as `not-found` names the one diagnosis it
// rules out, and the frontend branches on the code.
#[cfg(unix)]
#[test]
fn an_unreadable_path_is_permission_denied_not_not_found() {
    use super::check_document_path;
    use crate::command_error::ErrorCode;
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("tempdir");
    let closed = dir.path().join("closed");
    std::fs::create_dir(&closed).expect("mkdir");
    let inside = closed.join("note.md");
    std::fs::write(&inside, b"x").expect("write");
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o000)).expect("chmod");

    let observed = check_document_path(inside.to_str().unwrap());
    // Root ignores the mode bits, so there is nothing to assert there.
    let readable_anyway = std::fs::metadata(&inside).is_ok();
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o700)).expect("restore");
    if readable_anyway {
        return;
    }
    assert_eq!(
        observed.expect_err("unreadable").code(),
        ErrorCode::PermissionDenied
    );
}

// -- #139: the successful path, up to the hand-over ---------------------------

#[test]
fn a_regular_file_is_handed_to_the_registrar_exactly_as_given() {
    // libtest never runs on the main thread, so AppKit itself is out of
    // reach here; the registrar is the seam. A registrar that records what
    // it was given proves the guard passes a real document through, and
    // passes it unchanged — the URL AppKit notes is built from this string.
    let (_dir, path) = existing_file();
    let mut received = None;
    let outcome = try_register_with(&path, |p| {
        received = Some(p.to_string());
        Ok(())
    });
    assert_eq!(outcome, Ok(()));
    assert_eq!(received.as_deref(), Some(path.as_str()));
}

#[test]
fn the_registrars_own_refusal_is_returned_as_is() {
    let (_dir, path) = existing_file();
    let outcome = try_register_with(&path, |_| Err(SkipReason::NotMainThread));
    assert_eq!(outcome, Err(SkipReason::NotMainThread));
}

#[test]
fn a_missing_path_or_a_directory_never_reaches_the_registrar() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone.md");
    let never = |_: &str| -> Result<(), SkipReason> { panic!("the guard must stop first") };
    assert_eq!(
        try_register_with(missing.to_str().unwrap(), never),
        Err(SkipReason::PathMissing)
    );
    assert_eq!(
        try_register_with(dir.path().to_str().unwrap(), never),
        Err(SkipReason::NotAFile)
    );
}
