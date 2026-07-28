//! The token directory's policy (audit round 1 finding 3; round 2 item 1).
//!
//! Round 1 verified the 0700 chmod instead of applying it blind but kept every
//! failure non-fatal, on the reasoning that a loose directory leaks the token
//! file's NAME and not the secret. That is true of a READABLE directory and
//! false of a WRITABLE one: on a directory another user can write, they unlink
//! our 0600 file and put their own there, and the file's own mode defends
//! nothing. These tests pin the two apart.

#![cfg(unix)]

use super::*;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::tempdir;

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).expect("stat").permissions().mode() & 0o777
}

// --- the chmod-and-re-stat itself -------------------------------------------

/// The tightening must be VERIFIED, not applied blind — and a directory this
/// process owns ends up owner-only, which is the silent case.
#[test]
fn hardening_the_parent_directory_is_verified() {
    let dir = tempdir().unwrap();
    let parent = dir.path().join("app-data");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();

    let guard = harden_parent_dir(&parent).expect("0700 must be applied and confirmed");

    assert_eq!(guard, DirGuard::Secured);
    assert_eq!(mode_of(&parent), 0o700);
}

/// A mode that cannot be read is not a mode that can be trusted: the stat
/// failure is an error, never a silent pass.
#[test]
fn hardening_a_missing_directory_reports_the_failure() {
    let dir = tempdir().unwrap();

    let err = harden_parent_dir(&dir.path().join("gone"))
        .expect_err("a hardening failure must be surfaced, not assumed away");

    assert!(err.contains("gone"), "{err}");
}

#[test]
fn the_guard_passes_an_owner_only_directory() {
    let dir = tempdir().unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();

    guard_parent_dir(dir.path()).expect("0700 is the target state");
}

// --- the verdict, per observed mode -----------------------------------------
//
// Carried as a plain mode because the case that matters — a directory this
// process cannot chmod back to 0700 — cannot be created in a unit test
// without root.

#[test]
fn a_world_writable_parent_is_refused() {
    let dir = tempdir().unwrap();

    let err = classify_dir_mode(dir.path(), 0o777)
        .expect_err("a world-writable token directory permits file replacement");

    assert!(
        err.contains("0777"),
        "the observed mode must be named: {err}"
    );
    assert!(
        err.contains("0700"),
        "the required mode must be named: {err}"
    );
    assert!(
        err.contains(&dir.path().display().to_string()),
        "the directory must be named: {err}"
    );
}

#[test]
fn a_group_writable_parent_is_refused() {
    let dir = tempdir().unwrap();

    for mode in [0o770, 0o720, 0o730] {
        let err = classify_dir_mode(dir.path(), mode)
            .expect_err("a group-writable token directory permits file replacement");
        assert!(err.contains("writable"), "mode {mode:04o}: {err}");
        assert!(err.contains(&format!("{mode:04o}")), "{err}");
    }
}

/// Readable-but-not-writable is tolerable: it leaks the file's name, and the
/// file's verified 0600 still guards the secret. Warn, do not refuse.
#[test]
fn a_group_readable_parent_proceeds_with_a_warning() {
    let dir = tempdir().unwrap();

    for mode in [0o750, 0o755, 0o740, 0o701] {
        match classify_dir_mode(dir.path(), mode) {
            Ok(DirGuard::NameVisible(warning)) => assert!(
                warning.contains(&format!("{mode:04o}")),
                "the warning must name the mode: {warning}"
            ),
            other => panic!("mode {mode:04o} must warn, not {other:?}"),
        }
    }
}

#[test]
fn the_owner_only_parent_is_silent() {
    let dir = tempdir().unwrap();

    assert_eq!(
        classify_dir_mode(dir.path(), 0o700).expect("0700 is the target state"),
        DirGuard::Secured
    );
}

/// The sticky/setgid bits live above the permission byte. They must be masked
/// off before the verdict, or an otherwise perfect 0700 directory carrying one
/// of them would read as "not 0700" and warn for nothing.
#[test]
fn high_mode_bits_are_masked_off_before_the_verdict() {
    let dir = tempdir().unwrap();
    let parent = dir.path().join("sticky");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o1700)).unwrap();

    assert_eq!(
        observed_dir_mode(&parent).expect("stat"),
        0o700,
        "the high bits are not permission bits"
    );
}
