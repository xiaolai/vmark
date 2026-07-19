// Audit R1 fix — IPC path guard: traversal, absolute paths, backslashes,
// empty paths, and symlink escapes are all rejected; ordinary nested
// relative paths resolve inside the canonical root.

use super::*;

fn root() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn ordinary_paths_resolve_inside_root() {
    let dir = root();
    std::fs::create_dir_all(dir.path().join("ch1")).unwrap();
    let resolved = resolve_workspace_rel(dir.path(), "ch1/scene.md").unwrap();
    assert!(resolved.starts_with(dir.path().canonicalize().unwrap()));
    // Non-existent leaf is fine — capture creates it.
    assert!(resolve_workspace_rel(dir.path(), "new-file.md").is_ok());
}

#[test]
fn traversal_and_absolute_paths_are_rejected() {
    let dir = root();
    for bad in [
        "../outside.md",
        "a/../../etc/passwd",
        "/etc/passwd",
        "",
        ".",
        "./x.md",
        "a\\b.md",
    ] {
        assert!(
            resolve_workspace_rel(dir.path(), bad).is_err(),
            "{bad:?} must be rejected"
        );
    }
}

#[cfg(unix)]
#[test]
fn symlink_escapes_are_rejected() {
    let dir = root();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
    let err = resolve_workspace_rel(dir.path(), "link/file.md").unwrap_err();
    assert!(err.contains("symlink"), "{err}");
    // A symlink inside the root is fine.
    std::fs::create_dir_all(dir.path().join("real")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
    assert!(resolve_workspace_rel(dir.path(), "alias/file.md").is_ok());
}
