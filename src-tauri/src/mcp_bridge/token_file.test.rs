//! WI-9 — the port file's permission contract.
//!
//! Before this module the 0600 mode was an accident of `tempfile` defaults,
//! and `preserve_target_permissions` carried any loosening forward on every
//! rewrite. These tests make the mode a checked property (audit 20260728 §2.2).

use super::*;
use std::fs;
use tempfile::tempdir;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(unix)]
fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).expect("stat").permissions().mode() & 0o777
}

// --- content contract (all platforms) --------------------------------------

#[test]
fn writes_port_and_token_in_the_discovery_format() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    write_port_file_at(&path, 51234, "deadbeef").expect("write");

    assert_eq!(fs::read_to_string(&path).unwrap(), "51234:deadbeef");
}

/// Port boundaries and a non-ASCII token must not corrupt the single-line
/// format the sidecar splits on `:`.
#[test]
fn handles_boundary_ports_and_unicode_tokens() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    for (port, token, expected) in [
        (0u16, "t", "0:t"),
        (65535, "t", "65535:t"),
        (1, "令牌", "1:令牌"),
    ] {
        write_port_file_at(&path, port, token).expect("write");
        assert_eq!(fs::read_to_string(&path).unwrap(), expected);
    }
}

#[test]
fn creates_the_app_data_directory_when_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("nested").join("deeper").join("mcp-port");

    write_port_file_at(&path, 9, "tok").expect("write");

    assert!(path.exists());
}

#[test]
fn rewriting_replaces_rather_than_appends() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    write_port_file_at(&path, 1111, "first").expect("first write");
    write_port_file_at(&path, 2222, "second").expect("second write");

    assert_eq!(fs::read_to_string(&path).unwrap(), "2222:second");
}

#[test]
fn a_path_with_no_parent_is_an_error() {
    let err = write_port_file_at(Path::new("/"), 1, "tok").expect_err("root has no parent");
    assert!(err.contains("parent"), "unexpected error: {err}");
}

// --- permission contract (unix only) ---------------------------------------

#[cfg(unix)]
#[test]
fn a_fresh_token_file_is_0600() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    write_port_file_at(&path, 51234, "deadbeef").expect("write");

    assert_eq!(mode_of(&path), 0o600, "the bridge token must be owner-only");
}

#[cfg(unix)]
#[test]
fn the_parent_directory_is_tightened_to_0700() {
    let dir = tempdir().unwrap();
    let parent = dir.path().join("app-data");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();

    write_port_file_at(&parent.join("mcp-port"), 51234, "deadbeef").expect("write");

    assert_eq!(
        mode_of(&parent),
        0o700,
        "another user must not be able to enumerate or replace the token file"
    );
}

/// The regression this module exists for: `atomic_replace` preserves the
/// target's existing mode, so a file that ever became group/world readable
/// used to keep that mode across every later token rotation.
#[cfg(unix)]
#[test]
fn a_previously_loosened_file_is_re_tightened_on_rewrite() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");
    fs::write(&path, "1111:stale").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        mode_of(&path),
        0o644,
        "precondition: file is world-readable"
    );

    write_port_file_at(&path, 2222, "fresh").expect("write");

    assert_eq!(mode_of(&path), 0o600);
    assert_eq!(fs::read_to_string(&path).unwrap(), "2222:fresh");
}

/// Even a wide-open file (0666) must come back locked down, and the new
/// secret must not be observable through the old permissive mode.
#[cfg(unix)]
#[test]
fn a_world_writable_file_is_re_tightened_on_rewrite() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");
    fs::write(&path, "1111:stale").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();

    write_port_file_at(&path, 3333, "fresh").expect("write");

    assert_eq!(mode_of(&path), 0o600);
}

/// Repeated rotations (the bridge restarting) must stay at 0600 — the
/// property has to hold for every write, not just the first.
#[cfg(unix)]
#[test]
fn every_rotation_keeps_the_file_at_0600() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    for i in 0..5u16 {
        write_port_file_at(&path, 40000 + i, &format!("token-{i}")).expect("write");
        assert_eq!(
            mode_of(&path),
            0o600,
            "rotation {i} loosened the token file"
        );
    }
}

// --- the staged write itself (audit round 1, finding 1) ---------------------

/// The token must never be *published* at a loose mode, not even briefly.
///
/// The old path went through `app_paths::atomic_write_file`, which PRESERVES
/// the target's permissions: a 0644 target handed 0644 to the temp file, so
/// the new secret was renamed into place world-readable and only a
/// post-write chmod cleaned it up afterwards. `write_secured` is asserted
/// here with NO post-write enforcement in the picture — whatever it renames
/// into place must already be 0600.
#[cfg(unix)]
#[test]
fn the_staged_write_publishes_0600_with_no_post_write_chmod() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");
    fs::write(&path, "1111:stale").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

    write_secured(&path, dir.path(), b"2222:fresh").expect("secure write");

    assert_eq!(
        mode_of(&path),
        0o600,
        "the published token must never inherit the target's mode"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "2222:fresh");
}

/// A leaked staging copy of the token would defeat the point of the 0600.
#[test]
fn the_secure_write_leaves_no_staging_file_behind() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    write_secured(&path, dir.path(), b"1:tok").expect("secure write");

    let entries: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(
        entries.len(),
        1,
        "only the token file may remain: {entries:?}"
    );
}

// --- mode enforcement helpers ----------------------------------------------

#[cfg(unix)]
#[test]
fn enforce_mode_applies_the_mode_and_re_stats_it() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("f");
    fs::write(&path, "x").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();

    enforce_mode(&path, 0o600).expect("enforce");

    assert_eq!(mode_of(&path), 0o600);
    verify_mode(&path, 0o600).expect("the mode it just set must verify");
    let err = verify_mode(&path, 0o644).expect_err("a mismatch must be reported, not assumed away");
    assert!(
        err.contains("0600"),
        "the error must name the actual mode: {err}"
    );
}

/// A `set_permissions` that nominally succeeds on a filesystem which does not
/// honour Unix modes must not be mistaken for a protected secret — that is
/// what the re-stat is for, so a stat failure is an error, never a pass.
#[cfg(unix)]
#[test]
fn verifying_a_missing_path_is_an_error_not_a_silent_pass() {
    let dir = tempdir().unwrap();

    let err = verify_mode(&dir.path().join("gone"), 0o600).expect_err("missing file");

    assert!(err.contains("stat"), "{err}");
}

// --- the directory policy, end to end (round 2, item 1) --------------------
//
// The verdict itself is `token_dir`'s; what has to hold HERE is that the
// verdict reaches the write: a refusal must withhold the token, and a mere
// warning must not cost the user the bridge. `force_observed_dir_mode` stands
// in for a directory this process cannot chmod, which needs root to create.

#[cfg(unix)]
use super::super::token_dir::force_observed_dir_mode;

/// End to end: a directory that stays writable by others means the token is
/// never published at all — refusing has to actually withhold the secret,
/// not merely log about it.
#[cfg(unix)]
#[test]
fn a_writable_token_directory_stops_the_token_from_being_written() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    force_observed_dir_mode(Some(0o777));
    let result = write_port_file_at(&path, 51234, "deadbeef");
    force_observed_dir_mode(None);

    let err = result.expect_err("publishing into a writable directory must be refused");
    assert!(err.contains("writable"), "{err}");
    assert!(!path.exists(), "the token must not reach disk");
}

/// The counterpart: a merely name-visible directory must NOT cost the user
/// the bridge — the token is published, at 0600, as before.
#[cfg(unix)]
#[test]
fn a_readable_token_directory_still_publishes_the_token() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");

    force_observed_dir_mode(Some(0o755));
    let result = write_port_file_at(&path, 51234, "deadbeef");
    force_observed_dir_mode(None);

    result.expect("a name-visible directory is tolerable");
    assert_eq!(fs::read_to_string(&path).unwrap(), "51234:deadbeef");
    assert_eq!(mode_of(&path), 0o600);
}

// --- cleanup after a failed enforcement (audit round 1, finding 2) ----------

/// Discarding the `remove_file` result let this report "refusing to expose
/// the token" while the readable token was still sitting on disk — the exact
/// opposite of what the caller was told.
#[test]
fn a_failed_cleanup_is_reported_next_to_its_cause() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");
    // `remove_file` cannot delete a directory on any supported platform.
    fs::create_dir(&path).unwrap();

    let err = abandon_unprotected_token(&path, "mode 0644, expected 0600".to_string());

    assert!(err.contains("mode 0644"), "the cause must survive: {err}");
    assert!(
        err.contains("could not be removed"),
        "the cleanup failure must be reported: {err}"
    );
    assert!(
        path.exists(),
        "precondition: the offending path is still there"
    );
}

#[test]
fn a_successful_cleanup_reports_only_the_cause() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("mcp-port");
    fs::write(&path, "1111:leaky").unwrap();

    let err = abandon_unprotected_token(&path, "mode 0644, expected 0600".to_string());

    assert!(!path.exists(), "the unprotected token must be deleted");
    assert!(err.contains("mode 0644"), "{err}");
    assert!(!err.contains("could not be removed"), "{err}");
}
