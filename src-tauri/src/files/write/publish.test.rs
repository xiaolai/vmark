//! Tests for how `files::write` puts a save in place (Unix, held folder).
//!
//! No-replace (Save As to a distinct destination): a file created by someone
//! else right before the rename is never replaced, and the refusal is a
//! typed `conflict` the frontend turns into `APPROVAL_REQUIRED`.
//!
//! Per-target lock: an alias and its referent are one file, so their writes
//! must not overlap — the second waits until the first has published. The
//! lock keys by the folder actually held and the case-folded entry name, so
//! a folder swapped for a link after the path was resolved changes nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use super::publish_hook::{before_hold, before_publish};
use super::{atomic_write_file_sync, write_checked, Publish};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::command_error::ErrorCode;

/// A file name no other test uses: the publish hook is keyed by name.
fn unique(stem: &str) -> String {
    format!("{stem}-{}.md", uuid::Uuid::new_v4())
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn save_as(target: &Path, content: &str) -> Result<(), crate::command_error::CommandError> {
    write_checked(target, content, Publish::NoReplace, |_| Ok(()))
}

#[test]
fn no_replace_refuses_a_file_created_right_before_publication_and_keeps_its_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let name = unique("save-as");
    let target = dir.path().join(&name);
    let racer = target.clone();
    before_publish(&name, move || fs::write(&racer, "theirs").unwrap());

    let err = save_as(&target, "ours").expect_err("a file created first must not be replaced");

    assert_eq!(fs::read_to_string(&target).unwrap(), "theirs");
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.save.targetExists"));
    let detail = err.detail().expect("structured detail");
    assert_eq!(detail["kind"], "target-exists");
    assert_eq!(detail["path"], target.to_string_lossy().as_ref());
    assert_eq!(entries(dir.path()), vec![name], "no temp file left behind");
}

#[test]
fn no_replace_publishes_an_absent_destination() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("最终 版.md");

    save_as(&target, "内容\n").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "内容\n");
    assert_eq!(entries(dir.path()), vec!["最终 版.md".to_owned()]);
}

#[test]
fn no_replace_through_an_alias_refuses_its_existing_referent() {
    let dir = tempfile::tempdir().unwrap();
    let referent = dir.path().join("real.md");
    fs::write(&referent, "theirs").unwrap();
    let alias = dir.path().join("alias.md");
    std::os::unix::fs::symlink(&referent, &alias).unwrap();

    let err = save_as(&alias, "ours").expect_err("the referent exists");

    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(fs::read_to_string(&referent).unwrap(), "theirs");
    assert!(fs::symlink_metadata(&alias)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn an_ordinary_save_still_replaces_a_file_created_before_publication() {
    let dir = tempfile::tempdir().unwrap();
    let name = unique("save");
    let target = dir.path().join(&name);
    let racer = target.clone();
    before_publish(&name, move || fs::write(&racer, "theirs").unwrap());

    atomic_write_file_sync(&target, "ours").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "ours");
}

/// Pause the write through `first` just before its rename, start a write
/// through `second`, and report whether `second` finished while `first` was
/// still paused. Afterwards both writes have completed.
fn second_finishes_while_first_is_paused(
    publish_name: &str,
    first: PathBuf,
    second: PathBuf,
) -> bool {
    second_finishes_while_first_is_paused_after(publish_name, first, second, || {})
}

/// As above, with `arm_second` run once `first` is paused, before `second`
/// starts — for a hook only the second write may meet.
fn second_finishes_while_first_is_paused_after(
    publish_name: &str,
    first: PathBuf,
    second: PathBuf,
    arm_second: impl FnOnce(),
) -> bool {
    let (paused_tx, paused_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    before_publish(publish_name, move || {
        paused_tx.send(()).unwrap();
        go_rx.recv().unwrap();
    });
    let a = thread::spawn(move || atomic_write_file_sync(&first, "first"));
    paused_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the first write reached publication");
    arm_second();

    let (done_tx, done_rx) = mpsc::channel();
    let b = thread::spawn(move || {
        let result = atomic_write_file_sync(&second, "second");
        done_tx.send(()).unwrap();
        result
    });
    let overlapped = done_rx.recv_timeout(Duration::from_millis(400)).is_ok();
    go_tx.send(()).unwrap();
    a.join().unwrap().unwrap();
    b.join().unwrap().unwrap();
    overlapped
}

#[test]
fn an_alias_write_and_a_referent_write_do_not_overlap_and_share_one_journal_document() {
    let dir = tempfile::tempdir().unwrap();
    let name = unique("lock");
    let referent = dir.path().join(&name);
    fs::write(&referent, "0").unwrap();
    let alias = dir.path().join("alias.md");
    std::os::unix::fs::symlink(&referent, &alias).unwrap();

    let overlapped = second_finishes_while_first_is_paused(&name, alias.clone(), referent.clone());

    assert!(
        !overlapped,
        "the referent write ran while the alias write was paused before its rename"
    );
    assert_eq!(
        fs::read_to_string(&referent).unwrap(),
        "second",
        "the write admitted second publishes last"
    );
    assert!(fs::symlink_metadata(&alias)
        .unwrap()
        .file_type()
        .is_symlink());
    let reg = DocRegistry::default();
    assert_eq!(
        reg.resolve(&format!("path:{}", alias.display())).unwrap(),
        reg.resolve(&format!("path:{}", referent.display()))
            .unwrap(),
        "one journal document for both paths"
    );
}

#[test]
fn another_spelling_on_a_case_insensitive_volume_is_serialized_too() {
    let dir = tempfile::tempdir().unwrap();
    let name = unique("case");
    let target = dir.path().join(&name);
    fs::write(&target, "0").unwrap();
    let upper = dir.path().join(name.to_uppercase());
    let one_file = crate::files::path_identity::file_id(&upper)
        == crate::files::path_identity::file_id(&target);
    if !one_file {
        return; // a case-sensitive volume: two files, nothing to serialize
    }
    // The publication renames onto the name as spelled by the first write.
    let overlapped = second_finishes_while_first_is_paused(&name, target.clone(), upper);

    assert!(!overlapped, "two spellings of one file wrote concurrently");
    assert_eq!(fs::read_to_string(&target).unwrap(), "second");
}

/// The second write resolves `swapped/<name>` while `swapped` is its own
/// folder; before it opens that folder, `swapped` becomes a link to the
/// first write's folder. Both now write one file, so the second must wait —
/// a lock keyed by the path resolved before the swap would let it through.
#[test]
fn a_folder_swapped_for_a_link_before_it_is_held_still_serializes_the_writes() {
    let root = tempfile::tempdir().unwrap();
    let name = unique("swap");
    let real = root.path().join("real");
    let swapped = root.path().join("swapped");
    fs::create_dir(&real).unwrap();
    fs::create_dir(&swapped).unwrap();
    let (link_to, link_at) = (real.clone(), swapped.clone());

    let overlapped = second_finishes_while_first_is_paused_after(
        &name,
        real.join(&name),
        swapped.join(&name),
        || {
            before_hold(&name, move || {
                fs::remove_dir(&link_at).unwrap();
                std::os::unix::fs::symlink(&link_to, &link_at).unwrap();
            })
        },
    );

    assert!(
        !overlapped,
        "the write through the swapped folder ran while the first was paused"
    );
    assert_eq!(fs::read_to_string(real.join(&name)).unwrap(), "second");
    assert!(fs::symlink_metadata(&swapped)
        .unwrap()
        .file_type()
        .is_symlink());
}
