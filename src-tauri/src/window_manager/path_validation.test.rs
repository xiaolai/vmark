//! Tests for `path_validation.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

/// An absolute path that does not exist, spelled for the platform the test is
/// running on.
///
/// `/definitely/...` is absolute on Unix and NOT absolute on Windows, where a
/// rooted path still needs a drive prefix. So on Windows `require_absolute`
/// refused these fixtures FIRST and the missing-path tests below pinned the
/// wrong refusal — "is not absolute" instead of "invalid path" — while still
/// looking like they covered the branch they are named for.
///
/// `cfg!` rather than `#[cfg]` deliberately: both arms are compiled on every
/// target, so a Windows cross-compile checks the Windows arm too.
fn missing_absolute(leaf: &str) -> String {
    if cfg!(windows) {
        format!(r"C:\definitely\does\not\exist\{leaf}")
    } else {
        format!("/definitely/does/not/exist/{leaf}")
    }
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
    let missing = missing_absolute("exist-vmark-test.md");
    let err = validate_openable_path(&missing).unwrap_err();
    assert!(err.contains("invalid path"), "got: {err}");
}

/// The cwd guard (audit #491/#493), pinned on its own.
///
/// Nothing asserted it anywhere: `require_absolute` shipped with no test, and
/// the only thing exercising it was the Windows accident above — a guard whose
/// sole coverage is another test hitting it by mistake is not covered. A
/// relative name is relative on every platform, so this runs everywhere.
#[test]
fn validate_rejects_a_relative_path() {
    let err = validate_openable_path("relative/note.md").unwrap_err();
    assert!(err.contains("is not absolute"), "got: {err}");
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
    let missing = missing_absolute("here-vmark-ws");
    let err = validate_workspace_root(&missing).unwrap_err();
    assert!(err.contains("invalid workspace root"), "got: {err}");
}

/// The workspace half of the cwd guard — see `validate_rejects_a_relative_path`.
#[test]
fn validate_workspace_root_rejects_a_relative_path() {
    let err = validate_workspace_root("relative-vmark-ws").unwrap_err();
    assert!(err.contains("is not absolute"), "got: {err}");
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

// -- #250: what each validator RETURNS is the value that flows on ------------

#[cfg(unix)]
#[test]
fn validate_returns_the_canonical_target_of_a_link_not_the_link() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("note.md");
    std::fs::write(&target, b"# hi").expect("write");
    let link = dir.path().join("today.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    let judged = validate_openable_path(link.to_str().unwrap()).expect("a link to markdown");

    assert_eq!(
        judged,
        target.canonicalize().expect("canonical").to_str().unwrap()
    );
}

#[cfg(unix)]
#[test]
fn validate_workspace_root_returns_the_canonical_directory() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let link = dir.path().join("link");
    let real = dir.path().join("real");
    std::fs::create_dir(&real).expect("mkdir");
    std::os::unix::fs::symlink(&real, &link).expect("symlink");

    let judged = validate_workspace_root(link.to_str().unwrap()).expect("a link to a directory");

    assert_eq!(
        judged,
        real.canonicalize().expect("canonical").to_str().unwrap()
    );
}
