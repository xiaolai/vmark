//! Tests for `legacy_archive.rs`: the handle compared against the original
//! is opened without following a symlink, so a link swapped in after the
//! `symlink_metadata` look-up can never be read as the copy.
//!
//! Edge cases: a symlink to a regular file holding the original's exact
//! bytes (the deleting case), a regular file (still opened and read), a
//! CJK file name.

use super::*;

#[cfg(unix)]
#[test]
fn a_symlink_is_never_opened_through() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("笔记.jsonl");
    std::fs::write(&target, b"same bytes").unwrap();
    let link = dir.path().join("笔记.jsonl.migrated");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    match open_no_follow(&link) {
        Err(e) => assert!(is_link_refusal(&e), "refused as a link: {e}"),
        Ok(file) => panic!(
            "opened through the link to a {:?}",
            file.metadata().unwrap().file_type()
        ),
    }
}

#[test]
fn a_regular_file_opens_and_reads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("笔记.jsonl");
    std::fs::write(&path, b"bytes").unwrap();
    let mut text = String::new();
    open_no_follow(&path)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(text, "bytes");
}

#[test]
fn an_identical_regular_copy_is_recognised() {
    let dir = tempfile::tempdir().unwrap();
    let original = dir.path().join("log.jsonl");
    let copy = dir.path().join("log.jsonl.migrated");
    std::fs::write(&original, "中文 line\n").unwrap();
    std::fs::write(&copy, "中文 line\n").unwrap();
    let mut o = Original::new(&original).unwrap();
    assert!(o.is_copy_at(&copy).unwrap());
}
