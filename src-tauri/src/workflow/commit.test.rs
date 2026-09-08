//! #257 — the save lands in the directory the sandbox validated.
//!
//! The property under test is not "a bad path is refused" (`actions.test.rs`
//! covers that) but "a path that goes bad AFTER the check cannot redirect the
//! write". `commit_with` takes the swap as a closure, so that window — the one
//! an attacker would have to hit — is driven here rather than raced.

use super::commit_inside_workspace;
#[cfg(unix)]
use super::commit_with;
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
fn a_fresh_file_is_written_whole_and_leaves_no_temp_file() {
    let (_parent, ws, _outside) = fixtures();
    fs::create_dir(ws.join("sub")).expect("mkdir");

    commit_inside_workspace(&ws.join("sub").join("doc.md"), &ws, b"committed").expect("inside");

    assert_eq!(
        fs::read_to_string(ws.join("sub").join("doc.md")).expect("read"),
        "committed"
    );
    assert_eq!(entries(&ws.join("sub")), vec!["doc.md".to_string()]);
}

#[test]
fn an_existing_file_is_replaced_and_keeps_its_permissions() {
    let (_parent, ws, _outside) = fixtures();
    let target = ws.join("doc.md");
    fs::write(&target, "old").expect("write");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("chmod");
    }

    commit_inside_workspace(&target, &ws, b"new").expect("replace");

    assert_eq!(fs::read_to_string(&target).expect("read"), "new");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&target).expect("stat").permissions().mode() & 0o777,
            0o640,
            "an atomic replace must not reset the file's mode to the temp file's 0600"
        );
    }
    assert_eq!(entries(&ws), vec!["doc.md".to_string()]);
}

#[test]
fn the_workspace_root_itself_is_a_valid_parent() {
    let (_parent, ws, _outside) = fixtures();
    commit_inside_workspace(&ws.join("top.md"), &ws, b"x").expect("the root contains itself");
    assert_eq!(fs::read_to_string(ws.join("top.md")).expect("read"), "x");
}

// ── the escape, before the commit ───────────────────────────────────────────

#[cfg(unix)]
#[test]
fn a_parent_that_resolves_outside_the_workspace_is_refused() {
    let (_parent, ws, outside) = fixtures();
    std::os::unix::fs::symlink(outside.path(), ws.join("out")).expect("symlink");

    let err = commit_inside_workspace(&ws.join("out").join("new.txt"), &ws, b"x")
        .expect_err("the parent escapes");

    assert!(err.contains("outside the workspace"), "got: {err}");
    assert!(entries(outside.path()).is_empty(), "nothing may be written");
}

// ── the escape, DURING the commit (#257) ────────────────────────────────────

/// The whole point of the descriptor. Validation passes on a real directory,
/// and only then is that directory's PATH re-pointed at somewhere outside the
/// workspace. A commit that resolves the path again — which every earlier
/// version did, at `NamedTempFile::new_in` and again at the rename — writes
/// the user's content where the link points. This one must not.
#[cfg(unix)]
#[test]
fn a_directory_swapped_after_validation_cannot_redirect_the_write() {
    let (_parent, ws, outside) = fixtures();
    let sub = ws.join("sub");
    fs::create_dir(&sub).expect("mkdir");
    let target = sub.join("doc.md");
    fs::write(&target, "the user's file").expect("seed");

    let err = commit_with(&target, &ws, b"redirected?", || {
        // Validation has seen the real `ws/sub`; now the NAME points out.
        fs::rename(&sub, ws.join("sub-real")).expect("move the real directory aside");
        std::os::unix::fs::symlink(outside.path(), &sub).expect("re-point the name");
    })
    .expect_err("the swapped path must not be written through");

    assert!(err.contains("outside the workspace"), "got: {err}");
    assert!(
        entries(outside.path()).is_empty(),
        "not one byte, not even a temp file, may reach the attacker's directory: {:?}",
        entries(outside.path())
    );
    assert_eq!(
        fs::read_to_string(ws.join("sub-real").join("doc.md")).expect("read"),
        "the user's file",
        "and the real file is untouched"
    );
}

/// The same swap, one step later: the directory is gone from its name by the
/// time the temp file would be created. The write is refused, and the temp
/// file it may have created is not left behind.
#[cfg(unix)]
#[test]
fn a_directory_removed_after_validation_refuses_rather_than_recreating_it() {
    let (_parent, ws, outside) = fixtures();
    let sub = ws.join("sub");
    fs::create_dir(&sub).expect("mkdir");

    let err = commit_with(&sub.join("doc.md"), &ws, b"x", || {
        fs::remove_dir(&sub).expect("the directory goes away");
    })
    .expect_err("there is nowhere to put it");

    assert!(!sub.exists(), "a removed directory is not recreated");
    assert!(entries(outside.path()).is_empty());
    assert!(!err.is_empty());
}

/// A swap that lands the temp file on the same filesystem but in another
/// directory INSIDE the workspace is still a redirect, and is still refused:
/// the descriptor names one directory, not "somewhere acceptable".
#[cfg(unix)]
#[test]
fn a_swap_to_another_directory_inside_the_workspace_is_refused_too() {
    let (_parent, ws, _outside) = fixtures();
    let sub = ws.join("sub");
    let other = ws.join("other");
    fs::create_dir(&sub).expect("mkdir");
    fs::create_dir(&other).expect("mkdir");

    let err = commit_with(&sub.join("doc.md"), &ws, b"x", || {
        fs::remove_dir(&sub).expect("rmdir");
        std::os::unix::fs::symlink(&other, &sub).expect("re-point");
    })
    .expect_err("the descriptor names `sub`, and `sub` is gone");

    assert!(err.contains("outside the workspace"), "got: {err}");
    assert!(
        entries(&other).is_empty(),
        "the redirected directory must stay empty: {:?}",
        entries(&other)
    );
}
