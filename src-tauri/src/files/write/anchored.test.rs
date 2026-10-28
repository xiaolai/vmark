// WI-RA14B.3 — the held-folder save: every entry named relative to the open
// folder, a link never written through, and a failed save leaving the old
// content and no temp file behind. `files/write.test.rs` drives the guard that
// sits on top; this file pins the folder primitives themselves.

use super::{HeldDir, Stage};
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::path::Path;

/// Names in `dir`, sorted — the only way to see a stray temp file.
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("read_dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn stage_name(stage: &Stage) -> &'static str {
    match stage {
        Stage::CreateTemp(_) => "create-temp",
        Stage::WriteTemp(_) => "write-temp",
        Stage::SyncTemp(_) => "sync-temp",
        Stage::Persist(_) => "persist",
        Stage::TargetExists => "target-exists",
        Stage::NoReplaceUnsupported => "no-replace-unsupported",
    }
}

#[test]
fn open_refuses_a_file_and_a_path_with_a_nul() {
    let tmp = tempfile::tempdir().expect("tempdir");
    fs::write(tmp.path().join("f.md"), "x").expect("write");

    assert!(HeldDir::open(&tmp.path().join("f.md")).is_err());
    assert!(HeldDir::open(&tmp.path().join("missing")).is_err());
    let nul = HeldDir::open(Path::new("/tmp/a\u{0}b")).err().expect("NUL");
    assert_eq!(nul.kind(), std::io::ErrorKind::InvalidInput);
}

#[test]
fn identity_is_the_folders_device_and_inode() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let meta = fs::metadata(tmp.path()).expect("meta");

    let held = HeldDir::open(tmp.path()).expect("open");

    assert_eq!(held.identity().expect("identity"), (meta.dev(), meta.ino()));
}

#[test]
fn entry_identity_names_the_entry_itself_not_a_links_target() {
    let tmp = tempfile::tempdir().expect("tempdir");
    fs::write(tmp.path().join("doc.md"), "x").expect("write");
    symlink(tmp.path().join("doc.md"), tmp.path().join("link.md")).expect("symlink");
    let held = HeldDir::open(tmp.path()).expect("open");
    let doc = fs::metadata(tmp.path().join("doc.md")).expect("meta");
    let link = fs::symlink_metadata(tmp.path().join("link.md")).expect("lmeta");

    assert_eq!(
        held.entry_identity(OsStr::new("doc.md")).unwrap(),
        Some((doc.dev(), doc.ino()))
    );
    assert_eq!(
        held.entry_identity(OsStr::new("link.md")).unwrap(),
        Some((link.dev(), link.ino()))
    );
    assert_ne!(link.ino(), doc.ino());
    assert_eq!(held.entry_identity(OsStr::new("missing")).unwrap(), None);
    // A stat that fails for a reason other than "nothing there" is an error.
    assert!(held.entry_identity(OsStr::new("doc.md/x")).is_err());
    assert!(held.entry_identity(OsStr::new("a\u{0}b")).is_err());
}

#[test]
fn the_held_folder_is_written_even_after_its_path_is_swapped() {
    let parent = tempfile::tempdir().expect("tempdir");
    let ws = parent.path().join("ws");
    let elsewhere = parent.path().join("elsewhere");
    fs::create_dir(&ws).expect("mkdir");
    fs::create_dir(&elsewhere).expect("mkdir");
    let held = HeldDir::open(&ws).expect("open");

    // After the folder was judged, its NAME is moved away and replaced by a
    // link to somewhere else. The write must land in the folder that was held.
    let moved = parent.path().join("ws-moved");
    fs::rename(&ws, &moved).expect("move");
    symlink(&elsewhere, &ws).expect("swap");
    held.replace(OsStr::new("doc.md"), b"held")
        .map_err(|s| stage_name(&s))
        .expect("replace");

    assert_eq!(fs::read_to_string(moved.join("doc.md")).unwrap(), "held");
    assert!(
        entries(&elsewhere).is_empty(),
        "nothing reached the swap target"
    );
}

#[test]
fn create_new_creates_once_and_never_through_a_link() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside");
    symlink(
        outside.path().join("planted.md"),
        tmp.path().join("link.md"),
    )
    .expect("symlink");
    let held = HeldDir::open(tmp.path()).expect("open");

    let mut file = held.create_new(OsStr::new("new.md")).expect("create");
    file.write_all(b"fresh").expect("write");
    let again = held.create_new(OsStr::new("new.md")).expect_err("exists");
    assert_eq!(again.kind(), std::io::ErrorKind::AlreadyExists);
    // A dangling link at the name is an existing entry: refused, and its
    // target outside the folder is not created.
    assert!(held.create_new(OsStr::new("link.md")).is_err());

    assert_eq!(
        fs::read_to_string(tmp.path().join("new.md")).unwrap(),
        "fresh"
    );
    assert!(entries(outside.path()).is_empty());
}

#[test]
fn replace_writes_whole_content_and_leaves_no_temp_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    fs::write(tmp.path().join("doc.md"), "old content that is longer").expect("write");
    let held = HeldDir::open(tmp.path()).expect("open");

    let text = "# 标题\r\nline two\r\n";
    held.replace(OsStr::new("doc.md"), text.as_bytes())
        .map_err(|s| stage_name(&s))
        .expect("replace");
    held.replace(OsStr::new("fresh.md"), b"")
        .map_err(|s| stage_name(&s))
        .expect("create through replace");

    assert_eq!(fs::read_to_string(tmp.path().join("doc.md")).unwrap(), text);
    assert_eq!(fs::read(tmp.path().join("fresh.md")).unwrap(), b"");
    assert_eq!(entries(tmp.path()), vec!["doc.md", "fresh.md"]);
}

#[test]
fn replace_carries_the_existing_permission_bits() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let doc = tmp.path().join("doc.md");
    fs::write(&doc, "old").expect("write");
    fs::set_permissions(&doc, fs::Permissions::from_mode(0o640)).expect("chmod");
    let held = HeldDir::open(tmp.path()).expect("open");

    held.replace(OsStr::new("doc.md"), b"new")
        .map_err(|s| stage_name(&s))
        .expect("replace");
    held.replace(OsStr::new("brand-new.md"), b"x")
        .map_err(|s| stage_name(&s))
        .expect("replace");

    assert_eq!(fs::metadata(&doc).unwrap().mode() & 0o777, 0o640);
    // No existing entry: the temp file's private 0600 is what is left.
    let fresh = fs::metadata(tmp.path().join("brand-new.md")).unwrap();
    assert_eq!(fresh.mode() & 0o777, 0o600);
}

#[cfg(target_os = "macos")]
#[test]
fn replace_carries_extended_attributes_such_as_finder_tags() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let doc = tmp.path().join("doc.md");
    fs::write(&doc, "old").expect("write");
    xattr::set(&doc, "com.vmark.test-tag", b"blue").expect("set xattr");
    let held = HeldDir::open(tmp.path()).expect("open");

    held.replace(OsStr::new("doc.md"), b"new")
        .map_err(|s| stage_name(&s))
        .expect("replace");

    assert_eq!(fs::read_to_string(&doc).unwrap(), "new");
    assert_eq!(
        xattr::get(&doc, "com.vmark.test-tag").unwrap().as_deref(),
        Some(&b"blue"[..])
    );
}

#[test]
fn replace_swaps_a_link_at_the_name_and_never_writes_through_it() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside");
    let target = outside.path().join("precious.md");
    fs::write(&target, "keep").expect("write");
    symlink(&target, tmp.path().join("doc.md")).expect("symlink");
    let held = HeldDir::open(tmp.path()).expect("open");

    held.replace(OsStr::new("doc.md"), b"saved")
        .map_err(|s| stage_name(&s))
        .expect("replace");

    assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
    let doc = tmp.path().join("doc.md");
    assert!(fs::symlink_metadata(&doc).unwrap().file_type().is_file());
    assert_eq!(fs::read_to_string(&doc).unwrap(), "saved");
}

#[test]
fn a_failed_rename_keeps_what_was_there_and_removes_the_temp_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    // A non-empty folder at the name: `renameat` over it fails.
    fs::create_dir(tmp.path().join("doc.md")).expect("mkdir");
    fs::write(tmp.path().join("doc.md").join("inner"), "inner").expect("write");
    let held = HeldDir::open(tmp.path()).expect("open");

    let stage = held
        .replace(OsStr::new("doc.md"), b"new")
        .expect_err("fails");

    assert_eq!(stage_name(&stage), "persist");
    assert_eq!(entries(tmp.path()), vec!["doc.md"], "no temp file left");
    assert_eq!(
        fs::read_to_string(tmp.path().join("doc.md").join("inner")).unwrap(),
        "inner"
    );
}

#[test]
fn a_name_with_a_nul_fails_at_the_rename_and_leaves_no_temp_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    fs::write(tmp.path().join("doc.md"), "old").expect("write");
    let held = HeldDir::open(tmp.path()).expect("open");

    let stage = held
        .replace(OsStr::new("doc\u{0}.md"), b"new")
        .expect_err("fails");

    // The temp file is created first, so the failure is at the rename — and
    // the temp file must still be cleaned up.
    assert_eq!(stage_name(&stage), "persist");
    assert_eq!(entries(tmp.path()), vec!["doc.md"]);
    assert_eq!(
        fs::read_to_string(tmp.path().join("doc.md")).unwrap(),
        "old"
    );
}

#[test]
fn a_folder_that_refuses_new_entries_fails_at_create_temp() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ro = tmp.path().join("ro");
    fs::create_dir(&ro).expect("mkdir");
    fs::write(ro.join("doc.md"), "old").expect("write");
    let held = HeldDir::open(&ro).expect("open");
    fs::set_permissions(&ro, fs::Permissions::from_mode(0o500)).expect("chmod");

    let result = held.replace(OsStr::new("doc.md"), b"new");
    fs::set_permissions(&ro, fs::Permissions::from_mode(0o700)).expect("restore");

    // Root ignores directory permissions; the property is only observable as
    // an unprivileged user, which is how the app runs.
    // The folder's owner is the test's user: uid 0 means running as root.
    if fs::metadata(&ro).expect("meta").uid() != 0 {
        let stage = result.expect_err("read-only folder");
        assert_eq!(stage_name(&stage), "create-temp");
        assert_eq!(fs::read_to_string(ro.join("doc.md")).unwrap(), "old");
        assert_eq!(entries(&ro), vec!["doc.md"]);
    }
}
