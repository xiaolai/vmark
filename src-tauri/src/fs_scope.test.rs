//! Tests for `fs_scope.rs` — runtime fs + asset scope extension.
//!
//! Moved out of `file_open.test.rs` with the code they cover, when
//! `file_open.rs` crossed the 300-line limit.

// -- allow_fs_read runtime scope extension (mock Tauri app) --------------
//
// Covers the wiring that the CLI, Finder, and `open_*_in_new_window`
// entry points all rely on: calling `allow_fs_read(app, path)` must
// mutate the fs plugin's scope so `readTextFile(path)` in the webview
// later succeeds. Without this, the bug reported in #676 recurs
// silently — validators pass, but the webview read is still denied.

// tauri::test::MockRuntime crashes the test binary at startup on
// windows-latest (STATUS_ENTRYPOINT_NOT_FOUND). The `test` feature of
// tauri is not enabled on Windows (see Cargo.toml target-specific
// dev-dependency), and these tests are cfg-gated to match. macOS/Linux
// still exercise the scope-extension wiring end-to-end.
#[cfg(not(target_os = "windows"))]
use super::{allow_fs_read, allow_fs_read_dir};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_fs::FsExt;

#[cfg(not(target_os = "windows"))]
fn mock_app_with_fs() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app with fs plugin")
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_extends_scope_so_read_is_permitted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    // Sanity: a fresh mock scope does NOT already allow this arbitrary
    // path. If this flips, the rest of the test is meaningless.
    assert!(
        !app.fs_scope().is_allowed(&file),
        "mock fs scope should reject unknown path before extension"
    );

    allow_fs_read(app.handle(), file.to_str().unwrap());

    assert!(
        app.fs_scope().is_allowed(&file),
        "allow_fs_read should extend scope so the webview can read the path"
    );
}

/// #1252 — a workspace root must be granted RECURSIVELY.
///
/// `allow_file` grants one path; a workspace needs its whole tree. Tauri's
/// `allow_directory(path, recursive)` pushes `path/*` when false and `path/**`
/// when true, so a non-recursive grant leaves every SUBDIRECTORY out of scope.
///
/// It only reproduces off the home drive: capabilities/default.json covers
/// `$HOME/**`, `/Volumes/**`, `/mnt/**` and `/media/**`, which masks the gap on
/// macOS and Linux. On Windows `$HOME` is `C:\Users\<name>`, so a workspace on
/// `G:\` is covered by nothing at all.
///
/// Gated like every other mock-runtime test in this file: `tauri::test::
/// MockRuntime` crashes the test binary at startup on windows-latest, so the
/// import and `mock_app_with_fs` are both `cfg(not(windows))` — an ungated test
/// referencing them does not fail at runtime, it fails to COMPILE, and only on
/// Windows. The irony is not lost: a fix for a Windows bug, broken on Windows.
#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_dir_grants_nested_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("sub").join("deeper");
    std::fs::create_dir_all(&nested).expect("mkdir");
    let file = nested.join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    assert!(
        !app.fs_scope().is_allowed(&file),
        "mock fs scope should reject the nested path before extension"
    );

    allow_fs_read_dir(app.handle(), dir.path().to_str().unwrap());

    assert!(
        app.fs_scope().is_allowed(&file),
        "a workspace grant must reach files in SUBDIRECTORIES, not just the top level"
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_is_idempotent() {
    // Calling twice must not panic, error, or double-allow in a way
    // that breaks subsequent reads. The Finder cold-start path does
    // this when a file arrives via both the pending queue and a later
    // hot event.
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    allow_fs_read(app.handle(), file.to_str().unwrap());
    allow_fs_read(app.handle(), file.to_str().unwrap());

    assert!(app.fs_scope().is_allowed(&file));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_does_not_grant_unrelated_paths() {
    // Extending scope for one file must not leak into neighbors.
    let dir = tempfile::tempdir().expect("tempdir");
    let allowed = dir.path().join("keep.md");
    let other = dir.path().join("other.md");
    std::fs::write(&allowed, b"# hi").expect("write allowed");
    std::fs::write(&other, b"# hi").expect("write other");

    let app = mock_app_with_fs();
    allow_fs_read(app.handle(), allowed.to_str().unwrap());

    assert!(app.fs_scope().is_allowed(&allowed));
    assert!(
        !app.fs_scope().is_allowed(&other),
        "scope extension must be per-file, not per-directory"
    );
}
