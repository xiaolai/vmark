//! Tests for `document_windows.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

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
