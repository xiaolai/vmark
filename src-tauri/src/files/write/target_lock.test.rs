//! Tests for the per-file write lock: exclusion per key, independence across
//! keys, and reclamation on release and on panic.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use super::{in_flight, lock};
#[cfg(unix)]
use std::ffi::OsStr;

fn key(stem: &str) -> String {
    format!("{stem}-{}", uuid::Uuid::new_v4())
}

#[test]
fn a_second_holder_of_one_key_waits_for_the_first() {
    let k = key("same");
    let first = lock(k.clone());
    let (tx, rx) = mpsc::channel();
    let k2 = k.clone();
    let waiter = thread::spawn(move || {
        let _g = lock(k2);
        tx.send(()).unwrap();
    });

    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    drop(first);
    rx.recv_timeout(Duration::from_secs(5))
        .expect("admitted after release");
    waiter.join().unwrap();
}

#[test]
fn different_keys_do_not_wait_for_each_other() {
    let _a = lock(key("a"));
    let (tx, rx) = mpsc::channel();
    let b = key("b");
    thread::spawn(move || {
        let _g = lock(b);
        tx.send(()).unwrap();
    });
    rx.recv_timeout(Duration::from_secs(5))
        .expect("independent key");
}

#[test]
fn a_released_key_is_reclaimed() {
    let k = key("reclaim");
    drop(lock(k.clone()));
    assert!(!in_flight(&k));
}

#[test]
fn a_panicking_holder_still_releases_its_key() {
    let k = key("panic");
    let k2 = k.clone();
    let result = thread::spawn(move || {
        let _g = lock(k2);
        panic!("write failed mid-flight");
    })
    .join();
    assert!(result.is_err());
    assert!(!in_flight(&k));
    drop(lock(k)); // and it can be taken again
}

#[cfg(unix)]
#[test]
fn a_held_entry_key_is_the_folder_identity_and_the_folded_name() {
    use super::held_entry_key;
    let k = |folder, name: &str| held_entry_key(folder, OsStr::new(name));
    assert_eq!(k((1, 2), "Straße.md"), k((1, 2), "STRASSE.md"));
    assert_eq!(k((1, 2), "笔记.md"), k((1, 2), "笔记.md"));
    assert_ne!(k((1, 2), "a.md"), k((1, 3), "a.md"), "another folder");
    assert_ne!(k((1, 2), "a.md"), k((9, 2), "a.md"), "another device");
    assert_ne!(k((1, 2), "a.md"), k((1, 2), "b.md"));
}

/// HFS+ ignores zero-width joiners in names, so the lock must too.
#[cfg(unix)]
#[test]
fn a_held_entry_key_ignores_hfs_ignorable_code_points() {
    use super::held_entry_key;
    let k = |name: &str| held_entry_key((1, 2), OsStr::new(name));
    assert_eq!(k("a\u{200D}.md"), k("a.md"));
    assert_eq!(k("ı.md"), k("I.md"), "NTFS-style simple mapping too");
}
