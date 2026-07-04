//! Tests for `file_open.rs` (moved with `allow_fs_read` out of `lib.rs`;
//! included via `#[path]`).

use super::{partition_opened_urls, OpenedPaths};

// -- partition_opened_urls (pure Finder RunEvent::Opened routing) ---------
//
// The macOS Finder handler routes every opened URL through this pure
// partition: directories open workspace windows, supported files flow into
// the queue/emit decision (`window_manager::decide_file_open_locked`, tested
// in window_manager tests, as is the multi-workspace grouping), everything
// else is skipped. Predicates are injected so no real filesystem is needed.

#[cfg(unix)] // used only by the unix-gated fixture tests below
fn url(s: &str) -> tauri::Url {
    tauri::Url::parse(s).expect("parse url")
}

#[cfg(unix)]
fn is_md(p: &std::path::Path) -> bool {
    p.extension().and_then(|e| e.to_str()) == Some("md")
}

#[test]
fn partition_empty_input_yields_empty_buckets() {
    let out = partition_opened_urls(vec![], |_| false, |_| true);
    assert_eq!(out, OpenedPaths::default());
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_routes_directories_to_dirs() {
    let out = partition_opened_urls(vec![url("file:///Users/a/project")], |_| true, |_| false);
    assert_eq!(out.dirs, vec!["/Users/a/project"]);
    assert!(out.files.is_empty());
    assert!(out.skipped.is_empty());
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_routes_supported_files_to_files() {
    let out = partition_opened_urls(
        vec![url("file:///Users/a/note.md"), url("file:///Users/b/x.md")],
        |_| false,
        is_md,
    );
    assert_eq!(out.files, vec!["/Users/a/note.md", "/Users/b/x.md"]);
    assert!(out.dirs.is_empty());
    assert!(out.skipped.is_empty());
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_skips_unsupported_files() {
    let out = partition_opened_urls(
        vec![
            url("file:///Users/a/archive.zip"),
            url("file:///Users/a/ok.md"),
        ],
        |_| false,
        is_md,
    );
    assert_eq!(out.files, vec!["/Users/a/ok.md"]);
    assert_eq!(out.skipped, vec!["/Users/a/archive.zip"]);
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_skips_non_file_urls() {
    // A non-file scheme cannot be converted to a local path — it must be
    // skipped, never crash the handler or leak into the open queue.
    let out = partition_opened_urls(
        vec![
            url("https://example.com/note.md"),
            url("file:///Users/a/ok.md"),
        ],
        |_| false,
        is_md,
    );
    assert_eq!(out.files, vec!["/Users/a/ok.md"]);
    assert_eq!(out.skipped, vec!["https://example.com/note.md"]);
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_directory_takes_precedence_over_file_predicate() {
    // A directory named like a supported file (e.g. `notes.md/`) must open
    // as a workspace, not be queued as a file.
    let out = partition_opened_urls(vec![url("file:///Users/a/notes.md")], |_| true, is_md);
    assert_eq!(out.dirs, vec!["/Users/a/notes.md"]);
    assert!(out.files.is_empty());
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_mixed_batch_preserves_per_bucket_order() {
    let out = partition_opened_urls(
        vec![
            url("file:///ws1/a.md"),
            url("file:///dir1"),
            url("file:///ws2/b.md"),
            url("file:///ws1/c.zip"),
            url("file:///dir2"),
        ],
        |p| p.to_string_lossy().starts_with("/dir"),
        is_md,
    );
    assert_eq!(out.dirs, vec!["/dir1", "/dir2"]);
    assert_eq!(out.files, vec!["/ws1/a.md", "/ws2/b.md"]);
    assert_eq!(out.skipped, vec!["/ws1/c.zip"]);
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_files_with_unicode_paths_survive() {
    let out = partition_opened_urls(
        vec![url("file:///Users/a/%E4%B8%AD%E6%96%87%20notes.md")],
        |_| false,
        is_md,
    );
    assert_eq!(out.files, vec!["/Users/a/\u{4e2d}\u{6587} notes.md"]);
}

#[cfg(unix)] // POSIX path fixtures; production caller is macOS-only
#[test]
fn partition_multi_workspace_files_feed_grouping() {
    // End-to-end with the (already unit-tested) workspace grouping: files
    // from two directories partition into `files` and then group into two
    // workspace buckets — the exact flow handle_finder_opened runs.
    let out = partition_opened_urls(
        vec![url("file:///ws1/a.md"), url("file:///ws2/b.md")],
        |_| false,
        is_md,
    );
    let groups = crate::window_manager::group_paths_by_workspace(&out.files);
    assert_eq!(groups.len(), 2);
    assert_eq!(groups["/ws1"], vec!["/ws1/a.md"]);
    assert_eq!(groups["/ws2"], vec!["/ws2/b.md"]);
}

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
use super::allow_fs_read;
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
