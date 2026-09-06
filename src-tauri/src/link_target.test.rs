//! Tests for `link_target.rs` — resolving a save target through symlinks.
//!
//! Split out of `atomic_replace.test.rs` alongside the module they cover.

use super::*;
use crate::atomic_replace::atomic_replace;
use std::fs;
use tempfile::tempdir;

#[cfg(unix)]
#[test]
fn resolves_symlink_to_its_referent() {
    let dir = tempdir().unwrap();
    let original = dir.path().join("original.md");
    let alias = dir.path().join("alias.md");
    fs::write(&original, "original bytes").unwrap();
    std::os::unix::fs::symlink(&original, &alias).unwrap();

    let resolved = resolve_link_target(&alias).expect("alias must resolve");

    assert_eq!(resolved, fs::canonicalize(&original).unwrap());
}

#[cfg(unix)]
#[test]
fn saving_through_a_symlink_updates_the_referent_and_keeps_the_link() {
    let dir = tempdir().unwrap();
    let original = dir.path().join("original.md");
    let alias = dir.path().join("alias.md");
    fs::write(&original, "original bytes").unwrap();
    std::os::unix::fs::symlink(&original, &alias).unwrap();

    let target = resolve_link_target(&alias).unwrap();
    atomic_replace(&target, target.parent().unwrap(), b"edited bytes").unwrap();

    assert_eq!(fs::read_to_string(&original).unwrap(), "edited bytes");
    assert!(
        fs::symlink_metadata(&alias)
            .unwrap()
            .file_type()
            .is_symlink(),
        "the alias must still be a symlink after saving through it"
    );
}

#[cfg(unix)]
#[test]
fn resolves_a_chain_of_symlinks() {
    let dir = tempdir().unwrap();
    let original = dir.path().join("original.md");
    let middle = dir.path().join("middle.md");
    let outer = dir.path().join("outer.md");
    fs::write(&original, "x").unwrap();
    std::os::unix::fs::symlink(&original, &middle).unwrap();
    std::os::unix::fs::symlink(&middle, &outer).unwrap();

    assert_eq!(
        resolve_link_target(&outer).unwrap(),
        fs::canonicalize(&original).unwrap()
    );
}

/// A link stored as a RELATIVE path resolves against the link's own directory,
/// not the process working directory.
#[cfg(unix)]
#[test]
fn resolves_a_relative_symlink_against_the_links_own_directory() {
    let dir = tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let original = sub.join("original.md");
    fs::write(&original, "x").unwrap();
    let alias = sub.join("alias.md");
    std::os::unix::fs::symlink("original.md", &alias).unwrap();

    assert_eq!(
        resolve_link_target(&alias).unwrap(),
        fs::canonicalize(&original).unwrap()
    );
}

/// A dangling link still resolves — to the path it names — so saving creates
/// the referent rather than silently converting the link into a regular file.
#[cfg(unix)]
#[test]
fn dangling_symlink_resolves_to_its_named_referent() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("missing.md");
    let alias = dir.path().join("alias.md");
    std::os::unix::fs::symlink(&missing, &alias).unwrap();

    let resolved = resolve_link_target(&alias).expect("dangling link must resolve");

    assert_eq!(resolved.file_name().unwrap(), "missing.md");
    assert_eq!(
        resolved.parent().unwrap(),
        fs::canonicalize(dir.path()).unwrap()
    );
}

/// A link whose referent lives in a directory that does not exist cannot be
/// saved through: report it instead of replacing the link.
#[cfg(unix)]
#[test]
fn symlink_into_a_missing_directory_is_refused() {
    let dir = tempdir().unwrap();
    let alias = dir.path().join("alias.md");
    std::os::unix::fs::symlink(dir.path().join("nope").join("f.md"), &alias).unwrap();

    assert!(matches!(
        resolve_link_target(&alias),
        Err(LinkResolveError::ReferentParentMissing(_))
    ));
}

#[cfg(unix)]
#[test]
fn symlink_loop_is_refused_instead_of_hanging() {
    let dir = tempdir().unwrap();
    let a = dir.path().join("a.md");
    let b = dir.path().join("b.md");
    std::os::unix::fs::symlink(&b, &a).unwrap();
    std::os::unix::fs::symlink(&a, &b).unwrap();

    assert!(matches!(
        resolve_link_target(&a),
        Err(LinkResolveError::TooManyLinks)
    ));
}

/// An ordinary file is returned unchanged — resolution must not disturb the
/// overwhelmingly common non-link case.
#[test]
fn plain_file_resolves_to_itself() {
    let dir = tempdir().unwrap();
    let plain = dir.path().join("plain.md");
    fs::write(&plain, "x").unwrap();

    assert_eq!(
        resolve_link_target(&plain).unwrap(),
        fs::canonicalize(&plain).unwrap()
    );
}

/// A file that does not exist yet (ordinary Save As to a new name) resolves to
/// itself so the save can create it.
#[test]
fn not_yet_existing_file_resolves_to_itself() {
    let dir = tempdir().unwrap();
    let fresh = dir.path().join("fresh.md");

    let resolved = resolve_link_target(&fresh).unwrap();

    assert_eq!(resolved.file_name().unwrap(), "fresh.md");
}

/// A path whose PARENT is a regular file is not a link and not an I/O failure
/// — it is the caller's "the folder is gone" case, which routes the user into
/// Save As. Resolution must classify `ENOTDIR` like `NotFound`, or the error
/// arrives as a generic write failure instead (caught by
/// `file_write::tests::parent_that_is_a_file_reports_the_same_not_found_class`).
#[test]
fn a_parent_that_is_a_file_is_reported_as_a_missing_referent_parent() {
    let dir = tempdir().unwrap();
    let parent_as_file = dir.path().join("not-a-dir");
    fs::write(&parent_as_file, b"oops").unwrap();

    let resolved = resolve_link_target(&parent_as_file.join("note.md"));

    match resolved {
        // The parent canonicalizes (it is a real file), so resolution
        // succeeds and the caller's `is_dir` check reports it.
        Ok(path) => assert_eq!(path.file_name().unwrap(), "note.md"),
        Err(LinkResolveError::ReferentParentMissing(_)) => {}
        Err(other) => panic!("expected a not-found class, got {:?}", other),
    }
}
