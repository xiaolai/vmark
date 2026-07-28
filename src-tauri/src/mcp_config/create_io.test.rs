//! Tests for `create_io.rs` (included via `#[path]`).
//!
//! Round-2 finding 1 — creating a config that does not exist yet must be
//! BOTH failure-atomic and no-clobber. Round 1 bought the second by giving up
//! the first: it wrote straight to the destination, so a write, flush or sync
//! failure stranded a truncated `~/.claude.json` where there had been no file
//! at all.

use super::*;
use std::path::PathBuf;
use tempfile::tempdir;

const CONTENTS: &[u8] = br#"{"mcpServers":{"vmark":{"command":"/opt/vmark"}}}"#;

/// Half the bytes land, then the write dies — what ENOSPC or EIO looks like
/// from the caller's side. No portable filesystem hands us that on demand, so
/// it goes through the same seam the real writer does.
fn half_then_fail(file: &mut fs::File, contents: &[u8]) -> io::Result<()> {
    file.write_all(&contents[..contents.len() / 2])?;
    file.flush()?;
    Err(io::Error::new(io::ErrorKind::WriteZero, "simulated ENOSPC"))
}

/// A filesystem that will not hard-link: a network or FUSE-mounted home with
/// links withheld. Equally un-summonable on demand, so equally injected.
fn link_unsupported(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "simulated: hard links unavailable",
    ))
}

/// Everything in `dir` other than `keep` — i.e. leaked staging files.
fn leftovers(dir: &Path, keep: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p != keep)
        .collect()
}

#[test]
fn a_fresh_config_lands_complete_and_leaves_no_staging_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    assert!(create_new_config(&path, CONTENTS).unwrap());

    assert_eq!(fs::read(&path).unwrap(), CONTENTS);
    assert!(
        leftovers(dir.path(), &path).is_empty(),
        "the staged temp file must be unlinked once it is in place"
    );
}

#[test]
fn a_destination_that_appeared_is_refused_rather_than_clobbered() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "theirs").unwrap();

    assert!(
        !create_new_config(&path, CONTENTS).unwrap(),
        "an existing destination means retry, not overwrite"
    );

    assert_eq!(fs::read_to_string(&path).unwrap(), "theirs");
    assert!(leftovers(dir.path(), &path).is_empty());
}

#[test]
fn a_mid_write_failure_leaves_the_destination_absent_rather_than_partial() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    // Precisely the case round 1 stranded on disk.
    let err = create_new_config_via(&path, CONTENTS, half_then_fail, link_into_place)
        .expect_err("a failed write must not be reported as a created config");

    assert!(err.contains("simulated ENOSPC"), "unexpected: {err}");
    assert!(
        !path.exists(),
        "the destination must be absent, never partial"
    );
    assert!(
        fs::read_dir(dir.path()).unwrap().next().is_none(),
        "the half-written staging file must be gone too"
    );
}

#[test]
fn a_failure_before_any_byte_is_written_creates_nothing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("absent-dir").join("config.toml");

    let err =
        create_new_config(&path, CONTENTS).expect_err("cannot stage into a directory that is gone");

    assert!(err.contains("Failed to stage config"), "unexpected: {err}");
    assert!(!path.exists());
    assert!(
        !path.parent().unwrap().exists(),
        "staging must not conjure the directory either"
    );
}

#[cfg(unix)]
#[test]
fn a_fresh_config_is_owner_only_whatever_the_umask_allows() {
    // `~/.claude.json` and `~/.codex/config.toml` carry paths, env values and
    // tokens. The mode is pinned on the staged file and rides its inode into
    // place, so the umask never gets a say.
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");

    create_new_config(&path, CONTENTS).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, FRESH_CONFIG_MODE, "fresh config must not be {mode:o}");
}

#[cfg(unix)]
#[test]
fn the_destination_is_a_standalone_file_not_a_surviving_link_pair() {
    // The staged file is hard-linked into place; if it were left linked, a
    // later staging collision could reach the live config through the temp
    // name. Link count must be back to 1.
    use std::os::unix::fs::MetadataExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    create_new_config(&path, CONTENTS).unwrap();

    assert_eq!(fs::metadata(&path).unwrap().nlink(), 1);
}

// ---------------------------------------------------------------------------
// The no-hard-link fallback.
//
// Refusing outright would make the install impossible on a network or
// FUSE-mounted home for a property that is desirable rather than load-bearing:
// this path only ever creates a file that did not exist. So the link failure
// degrades to an exclusive in-place create — no-clobber kept, atomicity given
// up and logged. These pin that the trade is exactly that and no wider.
// ---------------------------------------------------------------------------

#[test]
fn a_filesystem_without_hard_links_still_gets_its_config() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    assert!(
        create_new_config_via(&path, CONTENTS, write_and_sync, link_unsupported).unwrap(),
        "a home that cannot hard-link must still be installable"
    );

    assert_eq!(fs::read(&path).unwrap(), CONTENTS);
    assert!(
        leftovers(dir.path(), &path).is_empty(),
        "the staged copy must be discarded before falling back, not left behind"
    );
}

#[test]
fn the_fallback_still_refuses_to_clobber_a_config_that_appeared() {
    // The property that is never traded. `create_new` is what carries it here,
    // exactly as `link(2)` does on the primary path.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "theirs").unwrap();

    assert!(
        !create_new_config_via(&path, CONTENTS, write_and_sync, link_unsupported).unwrap(),
        "an existing destination means retry, not overwrite — link or no link"
    );

    assert_eq!(fs::read_to_string(&path).unwrap(), "theirs");
    assert!(leftovers(dir.path(), &path).is_empty());
}

#[test]
fn a_mid_write_failure_in_the_fallback_removes_the_partial_file() {
    // The fallback writes in place, so a failure CAN strand a partial file —
    // unless it cleans up. "Absent, never partial" is restored for every
    // failure we observe; only a hard crash can defeat it.
    //
    // Reached directly rather than through `create_new_config_via`: a write
    // that fails during STAGING never gets as far as the link, so routing it
    // that way would re-test the staging cleanup and silently prove nothing
    // about this one.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    let link_err = io::Error::new(io::ErrorKind::Unsupported, "simulated: no hard links");
    let err = create_in_place(&path, CONTENTS, half_then_fail, &link_err)
        .expect_err("a failed write must not be reported as a created config");

    assert!(err.contains("simulated ENOSPC"), "unexpected: {err}");
    assert!(
        err.contains("partial file was removed"),
        "the message must say the cleanup happened: {err}"
    );
    assert!(
        !path.exists(),
        "the partial file must be removed, not left for the next install to read"
    );
    assert!(
        fs::read_dir(dir.path()).unwrap().next().is_none(),
        "and no staging file may survive either"
    );
}

#[test]
fn when_both_routes_fail_the_error_names_both() {
    // A directory that does not exist defeats the fallback too. The message
    // has to say why we fell back AND why the fallback closed, or the user is
    // left diagnosing a filesystem from a single errno.
    let dir = tempdir().unwrap();
    let path = dir.path().join("absent-dir").join("config.toml");

    // Staging fails first here, so reach past it to the arm under test.
    let link_err = io::Error::new(io::ErrorKind::Unsupported, "simulated: no hard links");
    let err = create_in_place(&path, CONTENTS, write_and_sync, &link_err)
        .expect_err("cannot create inside a directory that is gone");

    assert!(
        err.contains("no hard links"),
        "must name the link failure: {err}"
    );
    assert!(
        err.contains("could not create the file directly"),
        "must name the fallback failure too: {err}"
    );
    assert!(!path.exists());
}

#[cfg(unix)]
#[test]
fn the_fallback_config_is_owner_only_too() {
    // The degraded path gives up atomicity — it must not also quietly give up
    // the mode. `create_new` obeys the umask unless the mode is passed to
    // open(2), which is how round 1 shipped a 0644 config.
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");

    create_new_config_via(&path, CONTENTS, write_and_sync, link_unsupported).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
    assert_eq!(
        mode, FRESH_CONFIG_MODE,
        "fallback config must not be {mode:o}"
    );
}
