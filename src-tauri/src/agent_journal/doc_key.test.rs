//! WI-AL1.6 — identity keys (ADR-AL7): a symlink and its target are one
//! document (the canonical referent, as the save path resolves it), another
//! spelling of an existing file is that file's document, and a missing
//! name's spelling is kept exactly. Separator cleanup is tested with
//! `files/path_identity.rs`.

use std::fs;

use crate::agent_journal::doc_key::{file_id, path_identity_key};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::test_support::tmp;

/// Composed and decomposed spellings of a MISSING name are not folded: the
/// journal does not guess the volume's normalization.
#[test]
fn composed_and_decomposed_missing_names_keep_their_own_keys() {
    let dir = tmp();
    let nfc = path_identity_key(&dir.path().join("caf\u{e9}.md"));
    let nfd = path_identity_key(&dir.path().join("cafe\u{301}.md"));
    assert_ne!(nfc, nfd);
    assert!(nfd.ends_with("cafe\u{301}.md"), "{nfd:?}");
}

#[test]
fn a_case_insensitive_volume_resolves_another_spelling_to_the_same_document() {
    let docs = tmp();
    let p = docs.path().join("Note.md");
    fs::write(&p, "x").unwrap();
    let other = docs.path().join("NOTE.md");
    let same_file = file_id(&other).is_some() && file_id(&other) == file_id(&p);
    let reg = DocRegistry::default();
    let (a, b) = (
        reg.resolve(&format!("path:{}", p.display())),
        reg.resolve(&format!("path:{}", other.display())),
    );
    assert_eq!(
        a.unwrap() == b.unwrap(),
        same_file,
        "one document exactly when the volume says one file"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_and_its_target_are_one_document_by_canonical_path_and_file_id() {
    let docs = tmp();
    let target = docs.path().join("note.md");
    fs::write(&target, "x").unwrap();
    let link = docs.path().join("alias.md");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert_eq!(
        path_identity_key(&link),
        path_identity_key(&target),
        "canonical referent"
    );
    assert_eq!(file_id(&link), file_id(&target));
    let reg = DocRegistry::default();
    assert_eq!(
        reg.resolve(&format!("path:{}", link.display())).unwrap(),
        reg.resolve(&format!("path:{}", target.display())).unwrap()
    );
}

#[cfg(unix)]
#[test]
fn a_dangling_symlink_is_its_missing_target_before_and_after_creation() {
    let docs = tmp();
    let target = docs.path().join("missing.md");
    let link = docs.path().join("alias.md");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let reg = DocRegistry::default();
    let before = reg.resolve(&format!("path:{}", link.display())).unwrap();
    assert_eq!(
        reg.resolve(&format!("path:{}", target.display())).unwrap(),
        before
    );
    fs::write(&target, "created through the alias").unwrap();
    assert_eq!(
        reg.resolve(&format!("path:{}", link.display())).unwrap(),
        before
    );
}

/// `..` out of a folder that does not exist lands nowhere the filesystem
/// can say: it is refused, never keyed by removing text.
#[test]
fn dot_dot_out_of_a_missing_folder_is_refused() {
    let reg = DocRegistry::default();
    assert!(reg.resolve("path:/no/such/dir/../a.md").is_err());
    assert!(file_id(std::path::Path::new("/no/such/dir/a.md")).is_none());
}
