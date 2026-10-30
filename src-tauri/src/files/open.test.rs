//! Tests for `files/open.rs` (moved with `allow_fs_read` out of `lib.rs`;
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

// -- WI-LX1.1: a folder opened from Finder is a folder the user chose -------
//
// It is granted recursively and recorded exactly like a folder-picker choice,
// so the workspace window can read its tree and a later launch re-grants it.
// Before this, a Finder folder outside the static scope opened a window that
// could read nothing in it. Gated like every mock-runtime suite in the crate.
#[cfg(not(target_os = "windows"))]
mod finder_directory {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    use super::super::{off_event_loop, open_finder_directory};
    use crate::workspace::grants::WorkspaceGrants;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .manage(WorkspaceGrants::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    #[test]
    fn a_folder_from_finder_is_granted_recorded_and_opened() {
        let app = mock_app();
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(dir.path().join("sub")).expect("mkdir");
        let nested = dir.path().join("sub").join("note.md");
        std::fs::write(&nested, b"# hi").expect("write");
        let root = dir.path().canonicalize().expect("canonical");
        assert!(!app.fs_scope().is_allowed(&nested));

        open_finder_directory(app.handle(), dir.path().to_str().expect("utf-8"));

        assert!(app.fs_scope().is_allowed(&nested), "the tree is readable");
        assert!(
            app.asset_protocol_scope().is_allowed(&nested),
            "and its media renders"
        );
        assert!(app
            .state::<WorkspaceGrants>()
            .covers(root.to_str().expect("utf-8")));
        let windows = app.webview_windows();
        assert_eq!(windows.len(), 1, "one workspace window");
        let url = windows.values().next().expect("window").url().expect("url");
        assert!(
            url.query().is_some_and(|q| q.contains("workspaceRoot=")),
            "the window is scoped to the folder: {url}"
        );
    }

    #[test]
    fn a_folder_that_vanished_opens_and_grants_nothing() {
        let app = mock_app();
        let dir = tempfile::tempdir().expect("tempdir");
        let gone = dir.path().join("gone");

        open_finder_directory(app.handle(), gone.to_str().expect("utf-8"));

        assert!(app.webview_windows().is_empty());
        assert!(!app
            .state::<WorkspaceGrants>()
            .covers(gone.to_str().expect("utf-8")));
    }

    /// `RunEvent::Opened` is handled on the event loop, and a stale network
    /// mount blocks `canonicalize` (and the grant file's fsync) for the
    /// mount's timeout. The handler hands the batch off and returns at once.
    #[test]
    fn the_event_loop_hands_the_work_off_and_returns_at_once() {
        let (finished, done) = std::sync::mpsc::channel();
        let started = std::time::Instant::now();

        off_event_loop(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            finished.send(()).expect("receiver alive");
        });

        assert!(
            started.elapsed() < std::time::Duration::from_millis(200),
            "the caller did not wait for the slow work"
        );
        done.recv_timeout(std::time::Duration::from_secs(10))
            .expect("the work still ran");
    }

    /// Off the event loop, a Finder folder is still granted, recorded, and
    /// given its window — window creation from a worker is marshalled to the
    /// main thread, as it is for every `async` command that opens one.
    #[test]
    fn a_folder_opened_off_the_event_loop_is_granted_and_gets_its_window() {
        let app = mock_app();
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("note.md");
        std::fs::write(&nested, b"# hi").expect("write");
        let root = dir.path().canonicalize().expect("canonical");
        let handle = app.handle().clone();
        let path = dir.path().to_str().expect("utf-8").to_owned();
        let (finished, done) = std::sync::mpsc::channel();

        off_event_loop(move || {
            open_finder_directory(&handle, &path);
            finished.send(()).expect("receiver alive");
        });
        done.recv_timeout(std::time::Duration::from_secs(10))
            .expect("opened");

        assert!(app.fs_scope().is_allowed(&nested));
        assert!(app
            .state::<WorkspaceGrants>()
            .covers(root.to_str().expect("utf-8")));
        assert_eq!(app.webview_windows().len(), 1);
    }

    // -- WI-RA7.7: a path is text the OS handed over, and a file name may
    // contain a newline. It reaches the log escaped.

    fn assert_no_raw_line_break(lines: &[String]) {
        assert!(!lines.is_empty(), "the open was logged");
        for line in lines {
            assert!(
                !line.contains('\n') && !line.contains('\r'),
                "a path forged a log line: {line:?}"
            );
        }
    }

    #[test]
    fn a_refused_folder_whose_name_holds_a_newline_is_one_log_line() {
        let app = mock_app();
        let dir = tempfile::tempdir().expect("tempdir");
        let gone = dir
            .path()
            .join("gone\n[FileOpen] Opening directory: /etc\r");

        let lines = crate::peer_text::log_capture::captured_logs(|| {
            open_finder_directory(app.handle(), gone.to_str().expect("utf-8"));
        });

        assert!(app.webview_windows().is_empty());
        assert_no_raw_line_break(&lines);
    }

    #[cfg(unix)] // a newline is a legal file-name character only here
    #[test]
    fn an_opened_folder_whose_name_holds_a_newline_is_one_log_line() {
        let app = mock_app();
        let dir = tempfile::tempdir().expect("tempdir");
        // One path component: a `/` in it would name a nested directory.
        let odd = dir.path().join("notes\n[FileOpen] Opening directory: etc");
        std::fs::create_dir(&odd).expect("mkdir");

        let lines = crate::peer_text::log_capture::captured_logs(|| {
            open_finder_directory(app.handle(), odd.to_str().expect("utf-8"));
        });

        assert_eq!(app.webview_windows().len(), 1, "the folder still opens");
        assert_no_raw_line_break(&lines);
    }
}

#[test]
fn a_skipped_open_request_whose_name_holds_a_newline_is_one_log_line() {
    let skipped = vec![
        "/tmp/a.exe\n[Finder] Opening directory: /etc".to_string(),
        "/tmp/文档.bin".to_string(),
    ];
    let lines = crate::peer_text::log_capture::captured_logs(|| {
        super::log_skipped_opens(&skipped);
    });
    assert_eq!(lines.len(), 2, "one record per refused request: {lines:?}");
    assert!(lines.iter().all(|line| !line.contains('\n')), "{lines:?}");
    assert!(lines[1].contains("文档.bin"), "{}", lines[1]);
}
