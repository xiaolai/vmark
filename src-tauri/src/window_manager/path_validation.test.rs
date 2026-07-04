//! Tests for `path_validation.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

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
    // WI-1B.5: .zip is not in SUPPORTED_EXTENSIONS, so it must be
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

#[cfg(unix)]
#[test]
fn validate_rejects_supported_symlink_to_unregistered() {
    // Canonicalization catches a crafted symlink: the link name ends
    // in .md but it points at an unregistered target (.zip). This is
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
