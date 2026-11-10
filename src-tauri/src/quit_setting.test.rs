//! Tests for `quit_setting.rs` (included via `#[path]`).

use super::{init_confirm_quit, parse, read, remember_at, seed_gate, SETTING_PATH};
use crate::quit::{set_confirm_quit, CONFIRM_QUIT_ENABLED};
use std::sync::atomic::Ordering;

#[test]
fn parse_accepts_only_the_two_words() {
    assert_eq!(parse("true"), Some(true));
    assert_eq!(parse("false\n"), Some(false));
    assert_eq!(parse(""), None);
    assert_eq!(parse("1"), None);
    assert_eq!(parse("False"), None);
    assert_eq!(parse("\u{0}\u{0}"), None);
}

#[test]
fn round_trips_both_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("confirm-quit");
    remember_at(&path, false).unwrap();
    assert_eq!(read(&path), Some(false));
    remember_at(&path, true).unwrap();
    assert_eq!(read(&path), Some(true));
}

#[test]
fn missing_file_reads_as_unknown() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(read(&dir.path().join("confirm-quit")), None);
}

#[test]
fn corrupt_or_unreadable_file_reads_as_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("confirm-quit");
    std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(read(&path), None);
    // A directory where the file should be is unreadable as text.
    let as_dir = dir.path().join("sub");
    std::fs::create_dir(&as_dir).unwrap();
    assert_eq!(read(&as_dir), None);
}

#[test]
fn remembering_creates_the_directory() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("confirm-quit");
    remember_at(&path, false).unwrap();
    assert_eq!(read(&path), Some(false));
}

#[test]
fn a_failed_write_is_reported_not_panicked() {
    let dir = tempfile::tempdir().unwrap();
    // A file where the parent directory should be: nothing can be created in it.
    let blocker = dir.path().join("blocker");
    std::fs::write(&blocker, "x").unwrap();
    assert!(remember_at(&blocker.join("confirm-quit"), false).is_err());

    let path = dir.path().join("confirm-quit");
    remember_at(&path, true).unwrap();
    // Target is a directory now: replacement fails, the error is returned.
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(remember_at(&path, false).is_err());
}

#[test]
fn what_is_remembered_seeds_the_gate_of_the_next_launch() {
    let _lock = crate::quit::tests::TEST_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().unwrap();
    remember_at(&dir.path().join("confirm-quit"), false).unwrap();

    CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
    seed_gate(dir.path());
    assert!(!CONFIRM_QUIT_ENABLED.load(Ordering::SeqCst));
    CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
}

#[test]
fn the_sync_command_before_init_only_flips_the_live_gate() {
    let _lock = crate::quit::tests::TEST_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    set_confirm_quit(false);
    assert!(!CONFIRM_QUIT_ENABLED.load(Ordering::SeqCst));
    set_confirm_quit(true);
    assert!(CONFIRM_QUIT_ENABLED.load(Ordering::SeqCst));
}

#[test]
fn init_then_the_sync_command_persists_for_the_next_launch() {
    let _lock = crate::quit::tests::TEST_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("confirm-quit");

    init_confirm_quit(dir.path());
    set_confirm_quit(false);
    assert_eq!(read(&file), Some(false));
    set_confirm_quit(true);
    assert_eq!(read(&file), Some(true));

    // A fresh launch reads what the last sync left.
    set_confirm_quit(false);
    CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
    init_confirm_quit(dir.path());
    assert!(!CONFIRM_QUIT_ENABLED.load(Ordering::SeqCst));

    *SETTING_PATH.lock().unwrap_or_else(|p| p.into_inner()) = None;
    CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
}
