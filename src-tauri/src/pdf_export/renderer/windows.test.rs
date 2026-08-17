// WI-PDF2.1 — the parts of the Windows renderer that are testable without a
// live WebView2: URL construction, which is where a silent empty-PDF failure
// comes from.

use super::path_to_file_url;

#[test]
fn a_plain_path_becomes_a_file_url() {
    let url = path_to_file_url(r"C:\temp\doc.html").expect("plain path");
    assert!(url.starts_with("file:///"), "got {url}");
    assert!(url.ends_with("doc.html"), "got {url}");
}

#[test]
fn spaces_and_hashes_are_percent_encoded() {
    // Naive `format!("file://{path}")` navigates nowhere for these, and a
    // navigation to nowhere surfaces as an EMPTY PDF, not as an error.
    let url = path_to_file_url(r"C:\temp\my doc #2.html").expect("awkward path");
    assert!(!url.contains(' '), "space must be encoded: {url}");
    assert!(
        !url.contains('#'),
        "hash must be encoded — it would truncate: {url}"
    );
    assert!(url.contains("%20"), "got {url}");
    assert!(url.contains("%23"), "got {url}");
}

#[test]
fn a_percent_in_the_name_is_escaped_not_reinterpreted() {
    let url = path_to_file_url(r"C:\temp\100%.html").expect("percent path");
    assert!(
        url.contains("%25"),
        "a literal % must become %25, got {url}"
    );
}

#[test]
fn non_ascii_paths_survive() {
    let url = path_to_file_url(r"C:\temp\测试.html").expect("CJK path");
    assert!(url.starts_with("file:///"), "got {url}");
    assert!(!url.contains('测'), "must be percent-encoded, got {url}");
}

#[test]
fn a_relative_path_is_refused_rather_than_silently_wrong() {
    // `Url::from_file_path` requires an absolute path. A relative one would
    // otherwise produce a URL resolved against something unpredictable.
    let err = path_to_file_url("relative/doc.html").expect_err("relative must be refused");
    assert_eq!(err.code(), crate::command_error::ErrorCode::InvalidInput);
}
