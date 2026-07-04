//! Tests for `accelerators.rs` — pure diff logic and the commit-after-build
//! cache lifecycle (moved out of the source file per repo convention;
//! included via `#[path]`).

use super::*;
use std::sync::Mutex;

/// Cache-lifecycle tests share the module-scoped `ACCEL_CACHE`, so they
/// must not run in parallel with each other. Acquire this lock at the
/// start of any test that mutates or observes `ACCEL_CACHE`.
static STATIC_CACHE_LOCK: Mutex<()> = Mutex::new(());

fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

#[test]
fn diff_returns_all_when_current_is_empty() {
    let current = HashMap::new();
    let next = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
    let out = diff_accelerators(&current, &next);
    assert_eq!(
        out,
        vec![
            ("bold".into(), "CmdOrCtrl+B".into()),
            ("italic".into(), "CmdOrCtrl+I".into()),
        ]
    );
}

#[test]
fn diff_skips_unchanged_entries() {
    let current = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
    let next = current.clone();
    assert!(diff_accelerators(&current, &next).is_empty());
}

#[test]
fn diff_returns_only_changed_entries() {
    let current = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
    let next = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+Shift+I")]);
    assert_eq!(
        diff_accelerators(&current, &next),
        vec![("italic".into(), "CmdOrCtrl+Shift+I".into())]
    );
}

#[test]
fn diff_treats_empty_accelerator_as_a_change_and_reports_it() {
    // Empty string means "unbound" at the Rust layer; still a diff-worthy change.
    let current = map(&[("bold", "CmdOrCtrl+B")]);
    let next = map(&[("bold", "")]);
    assert_eq!(
        diff_accelerators(&current, &next),
        vec![("bold".into(), "".into())]
    );
}

#[test]
fn diff_ignores_keys_present_only_in_current() {
    // The frontend might stop tracking an item (e.g., feature removed).
    // We don't try to reset it — we only touch what the caller asks about.
    let current = map(&[("bold", "CmdOrCtrl+B"), ("ghost", "F12")]);
    let next = map(&[("bold", "CmdOrCtrl+B")]);
    assert!(diff_accelerators(&current, &next).is_empty());
}

#[test]
fn diff_is_sorted_for_deterministic_application_order() {
    let current = HashMap::new();
    let next = map(&[("z", "Ctrl+Z"), ("a", "Ctrl+A"), ("m", "Ctrl+M")]);
    let out = diff_accelerators(&current, &next);
    let ids: Vec<&str> = out.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, vec!["a", "m", "z"]);
}

// --- Cache-lifecycle tests ------------------------------------------------
// These poke the module-scoped `ACCEL_CACHE`. They must serialize via
// STATIC_CACHE_LOCK and clear state before each run; otherwise parallel
// `cargo test` scheduling would cross-contaminate them.

#[test]
fn commit_rebuild_replaces_the_baseline_atomically() {
    let _guard = STATIC_CACHE_LOCK.lock().unwrap();
    commit_rebuild(map(&[("bold", "CmdOrCtrl+B"), ("stale", "F12")]));

    // A later rebuild commits a completely new snapshot; nothing from the
    // previous baseline may survive.
    commit_rebuild(map(&[("save", "CmdOrCtrl+S")]));

    let snap = accel_cache_snapshot_for_test().expect("cache is Some after commit");
    assert_eq!(snap, map(&[("save", "CmdOrCtrl+S")]));
}

#[test]
fn commit_rebuild_creates_the_cache_when_uninitialized() {
    let _guard = STATIC_CACHE_LOCK.lock().unwrap();
    clear_state_for_test();

    commit_rebuild(map(&[("open", "CmdOrCtrl+O")]));

    let snap = accel_cache_snapshot_for_test().expect("cache created on first commit");
    assert_eq!(snap.get("open").map(String::as_str), Some("CmdOrCtrl+O"));
}

#[test]
fn baseline_survives_a_rebuild_that_never_commits() {
    // Contract behind the commit-after-build design: a menu construction
    // that fails mid-way never calls commit_rebuild, so the previous
    // baseline must remain exactly as it was — no partial repopulation.
    let _guard = STATIC_CACHE_LOCK.lock().unwrap();
    commit_rebuild(map(&[("bold", "CmdOrCtrl+B")]));

    // Simulated failed rebuild: a snapshot is built locally and dropped
    // without ever touching the module cache.
    let abandoned = map(&[("bold", ""), ("italic", "CmdOrCtrl+I")]);
    drop(abandoned);

    let snap = accel_cache_snapshot_for_test().expect("cache still Some");
    assert_eq!(snap, map(&[("bold", "CmdOrCtrl+B")]));
}
