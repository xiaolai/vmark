//! Tests for `atomic_replace.rs` — the shared atomic-replacement core.
//!
//! Caller-facing behavior (exact error strings, validation, sentinel
//! prefixes) stays pinned by the `app_paths` and `file_write` test suites;
//! these tests pin the core's own contract.

use super::*;
// Imported here rather than inherited through `use super::*`: the production
// module's `fs` import is #[cfg(unix)] (its only user is the permission
// helper), while these tests read and write files on every platform.
use std::fs;
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

// ─── B3: extended attributes (audit 20260906) ─────────────────────────────

/// Finder tags are user data. Replacing the inode without carrying the
/// original's extended attributes silently drops a tagged note out of the
/// user's tag-based organization on an ordinary save.
#[cfg(target_os = "macos")]
#[test]
fn preserves_finder_tags_across_a_save() {
    const TAGS: &str = "com.apple.metadata:_kMDItemUserTags";
    let dir = tempdir().unwrap();
    let target = dir.path().join("tagged.md");
    fs::write(&target, "old").unwrap();

    let plist = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><array><string>Red</string></array></plist>";
    xattr::set(&target, TAGS, plist).unwrap();
    assert!(xattr::get(&target, TAGS).unwrap().is_some());

    atomic_replace(&target, dir.path(), b"new").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "new");
    assert_eq!(
        xattr::get(&target, TAGS).unwrap().as_deref(),
        Some(plist.as_slice()),
        "an ordinary save must not discard the file's Finder tags"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn preserves_a_custom_extended_attribute() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("note.md");
    fs::write(&target, "old").unwrap();
    xattr::set(&target, "user.vmark.probe", b"kept").unwrap();

    atomic_replace(&target, dir.path(), b"new").unwrap();

    assert_eq!(
        xattr::get(&target, "user.vmark.probe").unwrap().as_deref(),
        Some(b"kept".as_slice())
    );
}

/// A brand-new file has nothing to carry over, and the absence of a source
/// must not make the write fail.
#[cfg(target_os = "macos")]
#[test]
fn new_file_without_a_prior_inode_still_writes() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("brand-new.md");

    atomic_replace(&target, dir.path(), b"hello").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
}

// ─── B1: a failed replacement must never destroy the original ─────────────
//
// The Windows branch used to `remove_file(target)` after ANY persist failure
// and retry the rename. When the failure came from the SOURCE temp file (an
// open handle without FILE_SHARE_DELETE), the deletion succeeded while both
// renames failed, leaving the user's document gone. `NamedTempFile::persist`
// already passes `overwrite: true`, so `MoveFileExW` carries
// `MOVEFILE_REPLACE_EXISTING` and an ordinary existing target never needed
// removing in the first place.
#[cfg(windows)]
#[test]
fn failed_persist_leaves_the_original_file_intact() {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;

    let dir = tempdir().unwrap();
    let target = dir.path().join("document.md");
    fs::write(&target, "IRREPLACEABLE").unwrap();

    // Hold the temp file open WITHOUT share-delete: Windows then refuses to
    // rename or delete it, so `persist` fails for a source-side reason.
    let mut guard = None;
    let err = atomic_replace_with(&target, dir.path(), |temp| {
        temp.write_all(b"new")?;
        guard = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(temp.path())
            .ok();
        Ok(())
    })
    .expect_err("a locked source temp file must fail the replacement");

    assert!(matches!(err, AtomicReplaceError::Persist(_)));
    drop(err);
    drop(guard);

    assert_eq!(
        fs::read_to_string(&target).unwrap(),
        "IRREPLACEABLE",
        "a failed replacement must never delete the user's existing file"
    );
}

/// A transient sharing refusal must be RIDDEN OUT, not turned into a failure —
/// and not into a deletion either.
///
/// `MoveFileExW` returns ERROR_ACCESS_DENIED while another handle holds the
/// target, which on Windows happens routinely: an antivirus scanner, a backup
/// agent, or another thread reading the document. The old remove-then-retry
/// survived this by accident and paid for it with the data loss above; the
/// replacement rides it out by retrying the ATOMIC move, so the target keeps
/// its previous bytes throughout.
///
/// Reproduced by holding the TARGET open without FILE_SHARE_DELETE from a
/// second thread and releasing it mid-flight.
#[cfg(windows)]
#[test]
fn a_transient_sharing_conflict_on_the_target_is_ridden_out() {
    use std::os::windows::fs::OpenOptionsExt;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let dir = tempdir().unwrap();
    let target = dir.path().join("contended.md");
    fs::write(&target, "OLD").unwrap();

    // Hold the target WITHOUT share-delete, so the replacement is refused,
    // then let go while the retry window is still open.
    let (holding, held) = mpsc::channel();
    let path = target.clone();
    let holder = thread::spawn(move || {
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)
            .expect("open the target");
        holding.send(()).unwrap();
        thread::sleep(Duration::from_millis(15));
        drop(handle);
    });

    held.recv().unwrap();
    atomic_replace(&target, dir.path(), b"NEW").expect("the retry must ride out the conflict");
    holder.join().unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "NEW");
}
