//! Tests for `file_write.rs` (moved with the code out of `lib.test.rs`;
//! included via `#[path]`).

use super::{atomic_write_file_sync, PARENT_MISSING_ERROR_PREFIX};

#[test]
fn atomic_write_succeeds_when_parent_dir_exists() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("note.md");

    atomic_write_file_sync(&target, "hello").expect("write should succeed");

    let read_back = std::fs::read_to_string(&target).expect("read back");
    assert_eq!(read_back, "hello");
}

#[test]
fn atomic_write_returns_parent_missing_sentinel_when_dir_gone() {
    // Regression test: if the parent directory was renamed/deleted
    // between open and save, `NamedTempFile::new_in` would fail with a
    // raw "No such file or directory (os error 2)". Our explicit
    // pre-flight check converts that to a recognizable sentinel so the
    // frontend can route into Save As instead of leaking the OS error.
    let dir = tempfile::tempdir().expect("create tempdir");
    let gone = dir.path().join("renamed-away");
    let target = gone.join("note.md");
    // gone/ is intentionally never created — the parent does not exist.

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent dir is missing");

    assert!(
        err.starts_with(PARENT_MISSING_ERROR_PREFIX),
        "expected sentinel prefix, got: {err}",
    );
    assert!(
        err.contains("renamed-away"),
        "expected missing dir path in error, got: {err}",
    );
    // Belt-and-suspenders: ensure we did NOT leak the raw OS error.
    assert!(
        !err.contains("os error 2"),
        "raw OS error must not leak when parent is missing, got: {err}",
    );
}

#[test]
fn atomic_write_returns_parent_missing_when_parent_is_a_file() {
    // Edge case: parent path exists but isn't a directory (someone
    // replaced the folder with a file of the same name).
    let dir = tempfile::tempdir().expect("create tempdir");
    let parent_as_file = dir.path().join("not-a-dir");
    std::fs::write(&parent_as_file, b"oops").expect("create file");
    let target = parent_as_file.join("note.md");

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent is a file, not a dir");
    assert!(err.starts_with(PARENT_MISSING_ERROR_PREFIX), "got: {err}");
}
