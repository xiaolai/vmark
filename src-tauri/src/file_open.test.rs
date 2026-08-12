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

