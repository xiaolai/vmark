//! Tests for `atomic_replace.rs` — the shared atomic-replacement core.
//!
//! Caller-facing behavior (exact error strings, validation, sentinel
//! prefixes) stays pinned by the `app_paths` and `file_write` test suites;
//! these tests pin the core's own contract.

use super::*;
use tempfile::tempdir;

#[test]
fn creates_new_file_with_contents() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("new.txt");

    atomic_replace(&target, dir.path(), b"hello").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
}

#[test]
fn replaces_existing_file() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("existing.txt");
    fs::write(&target, "old").unwrap();

    atomic_replace(&target, dir.path(), b"new").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "new");
}

/// Overwriting an existing file must preserve its permission bits — the temp
/// file is created 0600 on Unix and would otherwise win the rename.
#[cfg(unix)]
#[test]
fn preserves_existing_target_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let target = dir.path().join("script.sh");
    fs::write(&target, "old").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();

    atomic_replace(&target, dir.path(), b"new").unwrap();

    let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "atomic replace must not reset permissions");
}

#[test]
fn missing_parent_yields_create_temp_error() {
    let dir = tempdir().unwrap();
    let gone = dir.path().join("no-such-dir");
    let target = gone.join("file.txt");

    let err = atomic_replace(&target, &gone, b"x").expect_err("must fail");

    match err {
        AtomicReplaceError::CreateTemp { parent, .. } => assert_eq!(parent, gone),
        other => panic!("expected CreateTemp, got {:?}", other),
    }
}

#[test]
fn persist_failure_cleans_up_temp_file() {
    let dir = tempdir().unwrap();
    // A directory at the target path makes the final rename fail.
    let target = dir.path().join("subdir");
    fs::create_dir(&target).unwrap();

    let err = atomic_replace(&target, dir.path(), b"x").expect_err("must fail");
    assert!(matches!(err, AtomicReplaceError::Persist(_)));
    drop(err); // Dropping the PersistError removes its temp file.

    // No temp files left behind — only the subdir remains.
    let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(entries.len(), 1);
}

#[test]
fn empty_contents_produce_empty_file() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("empty.txt");
    fs::write(&target, "not empty").unwrap();

    atomic_replace(&target, dir.path(), b"").unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"");
}
