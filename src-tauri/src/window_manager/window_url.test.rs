//! Tests for `window_url.rs`: the query-string contract with the frontend
//! router. Split from `document_windows.test.rs` with the module.

use super::*;

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
