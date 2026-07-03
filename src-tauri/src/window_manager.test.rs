//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;

// -- get_workspace_root_for_file -------------------------------------------

#[test]
fn workspace_root_nested_file() {
    assert_eq!(
        get_workspace_root_for_file("/Users/alice/project/file.md"),
        Some("/Users/alice/project".to_string())
    );
}

#[test]
fn workspace_root_home_level_file() {
    assert_eq!(
        get_workspace_root_for_file("/Users/alice/file.md"),
        Some("/Users/alice".to_string())
    );
}

#[test]
fn workspace_root_root_level_file() {
    assert_eq!(get_workspace_root_for_file("/file.md"), None);
}

#[test]
fn workspace_root_empty_string() {
    assert_eq!(get_workspace_root_for_file(""), None);
}

// -- determine_file_open_action --------------------------------------------

#[test]
fn action_ready_with_window() {
    assert_eq!(
        determine_file_open_action(true, true),
        FileOpenAction::EmitToMainWindow,
    );
}

#[test]
fn action_ready_without_window() {
    assert_eq!(
        determine_file_open_action(true, false),
        FileOpenAction::QueueAndCreateWindow,
    );
}

#[test]
fn action_not_ready_with_window() {
    assert_eq!(
        determine_file_open_action(false, true),
        FileOpenAction::QueueOnly,
    );
}

#[test]
fn action_not_ready_without_window() {
    assert_eq!(
        determine_file_open_action(false, false),
        FileOpenAction::QueueOnly,
    );
}

// -- atomic decide / drain (WI-0.8, C3) ------------------------------------

fn paths(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn decide_emits_when_ready_with_window() {
    let mut state = FileOpenState::new();
    state.frontend_ready = true;
    let outcome = decide_file_open_locked(&mut state, true, paths(&["/a.md"]), None);
    match outcome {
        FileOpenOutcome::Emit(p) => assert_eq!(p.len(), 1),
        _ => panic!("expected Emit"),
    }
    // Emit path does NOT queue.
    assert!(state.pending.is_empty());
}

#[test]
fn decide_queues_and_requests_window_when_ready_without_window() {
    let mut state = FileOpenState::new();
    state.frontend_ready = true;
    let outcome = decide_file_open_locked(&mut state, false, paths(&["/a.md"]), Some("/ws"));
    assert!(matches!(
        outcome,
        FileOpenOutcome::Queued {
            create_window: true
        }
    ));
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending[0].workspace_root.as_deref(), Some("/ws"));
}

#[test]
fn decide_queues_only_when_not_ready() {
    let mut state = FileOpenState::new();
    let outcome = decide_file_open_locked(&mut state, true, paths(&["/a.md"]), None);
    assert!(matches!(
        outcome,
        FileOpenOutcome::Queued {
            create_window: false
        }
    ));
    assert_eq!(state.pending.len(), 1);
}

#[test]
fn drain_during_cold_start_then_emit_after_ready_no_drop_no_double() {
    // Models the interleaving the single lock now serializes: a cold-start
    // open is queued; the frontend then marks ready + drains in one step;
    // a subsequent open emits rather than re-queuing — so the first open is
    // delivered exactly once (drain), the second exactly once (emit).
    let mut state = FileOpenState::new();

    // Open A arrives before the frontend is ready → queued.
    let a = decide_file_open_locked(&mut state, true, paths(&["/A.md"]), None);
    assert!(matches!(a, FileOpenOutcome::Queued { .. }));
    assert_eq!(state.pending.len(), 1);

    // Frontend becomes ready and drains atomically → receives A exactly once.
    let drained = mark_ready_and_drain(&mut state);
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].path, "/A.md");
    assert!(state.frontend_ready);
    assert!(state.pending.is_empty());

    // Open B after ready → emitted (not re-queued), so not dropped.
    let b = decide_file_open_locked(&mut state, true, paths(&["/B.md"]), None);
    match b {
        FileOpenOutcome::Emit(p) => assert_eq!(p[0].path, "/B.md"),
        _ => panic!("expected Emit"),
    }
    assert!(state.pending.is_empty());
}

// -- group_paths_by_workspace ----------------------------------------------

#[test]
fn group_single_file() {
    let paths = vec!["/Users/alice/project/file.md".to_string()];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert_eq!(
        groups["/Users/alice/project"],
        vec!["/Users/alice/project/file.md"]
    );
}

#[test]
fn group_same_directory() {
    let paths = vec![
        "/Users/alice/project/a.md".to_string(),
        "/Users/alice/project/b.md".to_string(),
    ];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups["/Users/alice/project"].len(), 2);
}

#[test]
fn group_different_directories() {
    let paths = vec![
        "/Users/alice/proj1/a.md".to_string(),
        "/Users/alice/proj2/b.md".to_string(),
    ];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 2);
    assert!(groups.contains_key("/Users/alice/proj1"));
    assert!(groups.contains_key("/Users/alice/proj2"));
}

#[test]
fn group_root_level_file() {
    let paths = vec!["/file.md".to_string()];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert!(groups.contains_key(""));
}

#[test]
fn group_empty_input() {
    let groups = group_paths_by_workspace(&[]);
    assert!(groups.is_empty());
}

// -- queue_pending_file_opens ----------------------------------------------

#[test]
fn queue_single_file_with_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec!["/a/b.md".to_string()], Some("/a"));
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].path, "/a/b.md");
    assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
}

#[test]
fn queue_multiple_files_same_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(
        &mut pending,
        vec!["/a/x.md".to_string(), "/a/y.md".to_string()],
        Some("/a"),
    );
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
    assert_eq!(pending[1].workspace_root, Some("/a".to_string()));
}

#[test]
fn queue_without_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec!["/file.md".to_string()], None);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].workspace_root, None);
}

#[test]
fn queue_appends_to_existing() {
    let mut pending = vec![PendingFileOpen {
        path: "/existing.md".to_string(),
        workspace_root: None,
    }];
    queue_pending_file_opens(&mut pending, vec!["/new.md".to_string()], Some("/dir"));
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].path, "/existing.md");
    assert_eq!(pending[1].path, "/new.md");
}

#[test]
fn queue_empty_file_paths_is_noop() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec![], Some("/a"));
    assert!(pending.is_empty());
}

// -- get_cascaded_position ------------------------------------------------

#[test]
fn cascade_first_window() {
    let (x, y) = get_cascaded_position(0);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_third_window() {
    let (x, y) = get_cascaded_position(3);
    assert_eq!(x, BASE_X + 3.0 * CASCADE_OFFSET);
    assert_eq!(y, BASE_Y + 3.0 * CASCADE_OFFSET);
}

#[test]
fn cascade_wraps_after_max() {
    // Position at MAX_CASCADE should wrap to 0
    let (x, y) = get_cascaded_position(MAX_CASCADE);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_wraps_correctly() {
    // Position at MAX_CASCADE + 2 should be same as position 2
    let (x1, y1) = get_cascaded_position(2);
    let (x2, y2) = get_cascaded_position(MAX_CASCADE + 2);
    assert_eq!(x1, x2);
    assert_eq!(y1, y2);
}

// -- build_window_url -----------------------------------------------------

#[test]
fn url_no_params() {
    assert_eq!(build_window_url(None, None), "/");
}

#[test]
fn url_file_only() {
    let url = build_window_url(Some("/path/to/file.md"), None);
    assert!(url.starts_with("/?file="));
    assert!(url.contains("%2Fpath%2Fto%2Ffile.md"));
}

#[test]
fn url_workspace_only() {
    let url = build_window_url(None, Some("/workspace"));
    assert!(url.starts_with("/?workspaceRoot="));
}

#[test]
fn url_workspace_root_percent_encodes_reserved_chars() {
    // The dock-reopen path passes a workspace path read off disk straight
    // into this URL builder. Folder names can legally contain `?`, `#`,
    // `&`, and spaces on every supported platform — they must be
    // percent-encoded so the frontend's URLSearchParams parser receives
    // them intact instead of misinterpreting them as fragment / query
    // delimiters.
    let url = build_window_url(None, Some("/path with?x#y&z"));
    assert!(url.contains("workspaceRoot="), "url was {url}");
    assert!(!url.contains("?x"), "raw '?' leaked into url: {url}");
    assert!(!url.contains("#y"), "raw '#' leaked into url: {url}");
    assert!(!url.contains("&z"), "raw '&' leaked into url: {url}");
    assert!(url.contains("%3F"), "expected '?' encoded as %3F: {url}");
    assert!(url.contains("%23"), "expected '#' encoded as %23: {url}");
    assert!(url.contains("%26"), "expected '&' encoded as %26: {url}");
    assert!(url.contains("%20"), "expected ' ' encoded as %20: {url}");
}

#[test]
fn url_both_params() {
    let url = build_window_url(Some("/a/b.md"), Some("/a"));
    assert!(url.contains("file="));
    assert!(url.contains("workspaceRoot="));
    assert!(url.contains("&"));
}

// -- build_window_url_with_files ------------------------------------------

#[test]
fn url_with_files_empty() {
    assert_eq!(build_window_url_with_files(&[], None), "/");
}

#[test]
fn url_with_files_single() {
    let url = build_window_url_with_files(&["/a/b.md".to_string()], Some("/a"));
    assert!(url.contains("workspaceRoot="));
    assert!(url.contains("files="));
}

#[test]
fn url_with_files_multiple() {
    let files = vec!["/a/x.md".to_string(), "/a/y.md".to_string()];
    let url = build_window_url_with_files(&files, Some("/a"));
    assert!(url.contains("files="));
    // Files are JSON-encoded so they should contain the array
    assert!(url.contains("x.md"));
    assert!(url.contains("y.md"));
}

// -- allocate_window_label ------------------------------------------------

#[test]
fn allocate_label_returns_sequential_labels() {
    let l1 = allocate_window_label();
    let l2 = allocate_window_label();
    assert!(l1.starts_with("doc-"));
    assert!(l2.starts_with("doc-"));
    let n1: u32 = l1.strip_prefix("doc-").unwrap().parse().unwrap();
    let n2: u32 = l2.strip_prefix("doc-").unwrap().parse().unwrap();
    assert_eq!(n2, n1 + 1);
}

// -- pick_reopen_workspace_root_with --------------------------------------

#[test]
fn pick_reopen_returns_path_when_exists() {
    let pick = pick_reopen_workspace_root_with(Some("/some/workspace".to_string()), |_| true);
    assert_eq!(pick, Some("/some/workspace".to_string()));
}

#[test]
fn pick_reopen_returns_none_when_path_missing() {
    // Path was the user's last workspace but the folder has been deleted
    // or moved — fall back to no-workspace so the new window opens fresh.
    let pick = pick_reopen_workspace_root_with(Some("/deleted/path".to_string()), |_| false);
    assert_eq!(pick, None);
}

#[test]
fn pick_reopen_returns_none_when_snapshot_empty() {
    // Fresh install or all recents cleared — never opened a workspace.
    let pick = pick_reopen_workspace_root_with(None, |_| true);
    assert_eq!(pick, None);
}

#[test]
fn pick_reopen_picks_real_directory_via_filesystem() {
    // End-to-end check that the helper integrates correctly with
    // Path::is_dir — the real wrapper uses this exact predicate.
    let dir = tempfile::tempdir().expect("create tempdir");
    let real = dir.path().to_string_lossy().to_string();
    let missing = format!("{}/does-not-exist", real);

    assert_eq!(
        pick_reopen_workspace_root_with(Some(real.clone()), |p| std::path::Path::new(p).is_dir(),),
        Some(real),
    );
    assert_eq!(
        pick_reopen_workspace_root_with(Some(missing), |p| std::path::Path::new(p).is_dir(),),
        None,
    );
}

#[test]
fn pick_reopen_rejects_path_that_is_a_regular_file() {
    // A regression from `Path::is_dir()` to a weaker predicate like
    // `Path::exists()` would silently route the dock-reopen URL to a
    // file path — locking the rust-side guarantee in place with a test.
    let dir = tempfile::tempdir().expect("create tempdir");
    let file = dir.path().join("not-a-workspace.md");
    std::fs::write(&file, b"hi").expect("write");
    let file_str = file.to_string_lossy().to_string();

    assert_eq!(
        pick_reopen_workspace_root_with(Some(file_str), |p| std::path::Path::new(p).is_dir(),),
        None,
    );
}

// -- validate_openable_path -----------------------------------------------

#[test]
fn validate_accepts_existing_markdown_file() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"# hi").expect("write");
    let result = validate_openable_path(file.to_str().unwrap());
    assert!(result.is_ok(), "got {:?}", result);
}

#[test]
fn validate_rejects_missing_path() {
    let missing = "/definitely/does/not/exist-vmark-test.md";
    let err = validate_openable_path(missing).unwrap_err();
    assert!(err.contains("invalid path"), "got: {err}");
}

#[test]
fn validate_rejects_directory() {
    let dir = tempfile::tempdir().expect("create tempdir");
    // Directory with a registered-extension-looking name — extension
    // alone must not be enough to pass validation.
    let md_dir = dir.path().join("looks-like-note.md");
    std::fs::create_dir(&md_dir).expect("mkdir");
    let err = validate_openable_path(md_dir.to_str().unwrap()).unwrap_err();
    assert!(err.contains("not an openable VMark file"), "got: {err}");
}

#[test]
fn validate_rejects_unregistered_file_extension() {
    // WI-1B.5: .png is not in SUPPORTED_EXTENSIONS, so it must be
    // rejected even though the path exists. .txt is now accepted
    // (it's a registered Phase 1A format), so the test pivots to
    // an unambiguously unregistered extension.
    let dir = tempfile::tempdir().expect("create tempdir");
    let file = dir.path().join("archive.zip");
    std::fs::write(&file, b"PK\x03\x04").expect("write");
    let err = validate_openable_path(file.to_str().unwrap()).unwrap_err();
    assert!(err.contains("not an openable VMark file"), "got: {err}");
}

#[test]
fn validate_accepts_phase1a_extensions() {
    let dir = tempfile::tempdir().expect("create tempdir");
    for ext in ["md", "txt", "json", "yaml", "toml", "html", "ts"] {
        let file = dir.path().join(format!("file.{ext}"));
        std::fs::write(&file, b"data").expect("write");
        assert!(
            validate_openable_path(file.to_str().unwrap()).is_ok(),
            "Phase 1A extension .{ext} should pass validate_openable_path",
        );
    }
}

// -- validate_workspace_root ----------------------------------------------

#[test]
fn validate_workspace_root_accepts_existing_directory() {
    let dir = tempfile::tempdir().expect("create tempdir");
    assert!(validate_workspace_root(dir.path().to_str().unwrap()).is_ok());
}

#[test]
fn validate_workspace_root_rejects_missing_path() {
    let err = validate_workspace_root("/definitely/not/here-vmark-ws").unwrap_err();
    assert!(err.contains("invalid workspace root"), "got: {err}");
}

#[test]
fn validate_workspace_root_rejects_regular_file() {
    // A trusted workspace-context window must never be scoped to a file.
    let dir = tempfile::tempdir().expect("create tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"hi").expect("write");
    let err = validate_workspace_root(file.to_str().unwrap()).unwrap_err();
    assert!(err.contains("is not a directory"), "got: {err}");
}

#[cfg(unix)]
#[test]
fn validate_rejects_supported_symlink_to_unregistered() {
    // Canonicalization catches a crafted symlink: the link name ends
    // in .md but it points at an unregistered target (.png). This is
    // the concrete security reason validate_openable_path canonicalizes
    // before checking the extension. Phase 1B widens the registered
    // set, but the canonicalize-then-check ordering still rejects
    // any symlink whose target is unregistered.
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("real.zip");
    std::fs::write(&target, b"PK\x03\x04").expect("write target");
    let link = dir.path().join("looks-markdown.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    let err = validate_openable_path(link.to_str().unwrap()).unwrap_err();
    assert!(err.contains("not an openable VMark file"), "got: {err}");
}
