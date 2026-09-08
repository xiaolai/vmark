//! #257 — creating a missing parent cannot be redirected out of the workspace.
//!
//! The commit was anchored to a directory descriptor in round 2; the mkdir
//! that runs BEFORE it was not. `save_file` validates the path, then calls
//! this, and an ancestor replaced with a symlink in between made
//! `create_dir_all` walk out of the workspace and build the attacker's
//! directory tree for them. The write that followed was refused — that half
//! held — but a refused write is not the same as an untouched filesystem.
//!
//! As in `commit.test.rs`, the window is a closure rather than a race.

// The seam is exercised only by the Unix escape tests; off Unix the import
// would be unused, and `-D warnings` on the Windows leg is where that shows up
// (`scripts/check-cross-target.sh`).
#[cfg(unix)]
use super::create_parents_with;
use super::create_parents_within;
use std::fs;
use std::path::PathBuf;

/// A workspace inside a parent directory the test owns, plus an `outside`
/// directory that must stay empty in every escape test.
fn fixtures() -> (tempfile::TempDir, PathBuf, tempfile::TempDir) {
    let parent = tempfile::tempdir().expect("tempdir");
    let ws = parent.path().join("ws");
    fs::create_dir(&ws).expect("mkdir ws");
    let outside = tempfile::tempdir().expect("outside");
    (parent, ws, outside)
}

fn entries(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("read_dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn missing_parents_inside_the_workspace_are_created() {
    let (_parent, ws, _outside) = fixtures();

    create_parents_within(&ws.join("a").join("b").join("c"), &ws).expect("inside");

    assert!(ws.join("a").join("b").join("c").is_dir());
}

#[test]
fn a_parent_that_already_exists_is_accepted_as_it_is() {
    let (_parent, ws, _outside) = fixtures();
    let sub = ws.join("sub");
    fs::create_dir(&sub).expect("mkdir");

    create_parents_within(&sub, &ws).expect("nothing to do");

    assert_eq!(entries(&ws), vec!["sub".to_string()]);
}

#[test]
fn the_workspace_root_itself_needs_no_parents() {
    let (_parent, ws, _outside) = fixtures();
    create_parents_within(&ws, &ws).expect("the root contains itself");
}

// ── the escape ──────────────────────────────────────────────────────────────

/// An ancestor that ALREADY resolves outside is refused rather than built
/// into. `sandbox::validate_path` catches this one first in production, so
/// this is the belt to that brace — and the only reason the class stayed
/// invisible for a round.
#[cfg(unix)]
#[test]
fn an_ancestor_that_resolves_outside_the_workspace_creates_nothing() {
    let (_parent, ws, outside) = fixtures();
    std::os::unix::fs::symlink(outside.path(), ws.join("links")).expect("symlink");

    let err = create_parents_within(&ws.join("links").join("new"), &ws)
        .expect_err("the ancestor escapes");

    assert!(err.contains("outside the workspace"), "got: {err}");
    assert!(
        entries(outside.path()).is_empty(),
        "not one directory may be created there: {:?}",
        entries(outside.path())
    );
}

/// The window this file exists for. Validation saw the real `ws/sub`; only
/// then is that NAME re-pointed outside. A path-based `create_dir_all`
/// resolves the name again and happily builds `outside/new`.
#[cfg(unix)]
#[test]
fn a_parent_swapped_after_validation_creates_nothing_outside_the_workspace() {
    let (_parent, ws, outside) = fixtures();
    let sub = ws.join("sub");
    fs::create_dir(&sub).expect("mkdir");

    let result = create_parents_with(&sub.join("new"), &ws, || {
        fs::rename(&sub, ws.join("sub-real")).expect("move the real directory aside");
        std::os::unix::fs::symlink(outside.path(), &sub).expect("re-point the name");
    });

    assert!(
        entries(outside.path()).is_empty(),
        "the swapped name must not be built through: {:?}",
        entries(outside.path())
    );
    // Anchored, the mkdir lands in the directory the descriptor holds — the
    // one validation judged, wherever its name has been moved to since.
    assert!(result.is_ok(), "got: {result:?}");
    assert!(ws.join("sub-real").join("new").is_dir());
}

/// End to end, the scenario the fix is named after: the parent is created,
/// the name is swapped, and the commit that follows refuses.
#[cfg(unix)]
#[test]
fn a_parent_replaced_between_creation_and_commit_refuses_the_write() {
    let (_parent, ws, outside) = fixtures();
    let sub = ws.join("sub");
    fs::create_dir(&sub).expect("mkdir");
    let target = sub.join("new").join("doc.md");

    create_parents_within(target.parent().expect("parent"), &ws).expect("created inside");
    fs::rename(&sub, ws.join("sub-real")).expect("move the real directory aside");
    std::os::unix::fs::symlink(outside.path(), &sub).expect("re-point the name");

    let err = super::super::commit::commit_inside_workspace(&target, &ws, b"redirected?")
        .expect_err("the swapped parent must not be written through");

    assert!(!err.is_empty());
    assert!(
        entries(outside.path()).is_empty(),
        "not one byte may reach the attacker's directory: {:?}",
        entries(outside.path())
    );
}

// #539 — `exists()` answers `false` for a component it could not STAT, so an
// unreadable ancestor read as missing and the walk climbed past it, out of the
// workspace, where the refusal blamed containment for a permission problem.
#[cfg(unix)]
#[test]
fn an_unreadable_ancestor_is_reported_as_itself_not_as_a_containment_failure() {
    use std::os::unix::fs::PermissionsExt;

    let ws = tempfile::tempdir().expect("tempdir");
    let closed = ws.path().join("closed");
    std::fs::create_dir(&closed).expect("mkdir");
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o000)).expect("chmod");

    let readable_anyway = closed.join("a").try_exists().is_ok();
    let outcome = create_parents_within(&closed.join("a").join("b"), ws.path());
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o700)).expect("restore");
    // Root ignores the mode bits, so there is nothing to assert there.
    if readable_anyway {
        return;
    }
    let err = outcome.expect_err("an unreadable ancestor is not a missing one");
    assert!(err.contains("cannot examine"), "{err}");
    assert!(
        !err.contains("outside the workspace"),
        "a permission problem is not a containment refusal: {err}"
    );
}
