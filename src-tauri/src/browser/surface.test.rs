//! Unit tests for the `BrowserSurface` state container (WI-1.2 / WI-1.8).
//!
//! `BrowserSurface` is plain `Send` state (two mutexes + a grant list) — no
//! AppHandle, no native handles — so its teardown contract is testable here.

use super::*;
use crate::browser::recovery::{RecoveryAction, MAX_AUTO_RELOADS};

fn surface_with_tab(tab_id: &str) -> BrowserSurface {
    let s = BrowserSurface::default();
    s.registry.lock().unwrap().create(tab_id, "main").unwrap();
    s
}

#[test]
fn forget_tab_drops_the_registry_entry_and_the_crash_budget_together() {
    let s = surface_with_tab("t1");
    s.crash_trackers
        .lock()
        .unwrap()
        .entry("t1".into())
        .or_default()
        .on_crash();

    s.forget_tab("t1").unwrap();

    assert!(!s.registry.lock().unwrap().contains("t1"));
    assert!(!s.crash_trackers.lock().unwrap().contains_key("t1"));
}

#[test]
fn a_reused_tab_id_does_not_inherit_the_previous_tab_s_crash_budget() {
    // The bug this pins: destroy removed the registry entry but left the crash
    // tracker behind. A tab id reused later started life with an EXHAUSTED budget,
    // so its very first crash refused to auto-reload — and every unique tab ever
    // opened leaked one map entry for the life of the process.
    let s = surface_with_tab("t1");
    {
        let mut trackers = s.crash_trackers.lock().unwrap();
        let t = trackers.entry("t1".into()).or_default();
        for _ in 0..=MAX_AUTO_RELOADS {
            t.on_crash(); // burn the whole budget, then one past it
        }
        assert_eq!(t.on_crash(), RecoveryAction::ManualOnly);
    }

    s.forget_tab("t1").unwrap();
    s.registry.lock().unwrap().create("t1", "main").unwrap();

    let mut trackers = s.crash_trackers.lock().unwrap();
    let fresh = trackers.entry("t1".into()).or_default();
    assert_eq!(fresh.consecutive(), 0);
    assert_eq!(fresh.on_crash(), RecoveryAction::AutoReload);
}

#[test]
fn forget_tab_is_idempotent_for_an_unknown_tab() {
    let s = BrowserSurface::default();
    s.forget_tab("never-existed").unwrap();
    assert!(s.registry.lock().unwrap().is_empty());
}

#[test]
fn human_attachment_is_bound_to_generation_and_once_mode_is_consumed() {
    let s = surface_with_tab("t1");
    s.attach_tab("t1".into(), 3, true).unwrap();
    assert!(s.is_tab_attached("t1", 3));
    assert!(!s.is_tab_attached("t1", 4));
    // The consumption logic lives in the free `consume_attachment_in` (so the auth
    // gate can hold the attachments lock across a one-shot spend, authorize.rs).
    assert!(super::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        3
    ));
    assert!(!s.is_tab_attached("t1", 3));

    s.attach_tab("t1".into(), 5, false).unwrap();
    assert!(super::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        5
    ));
    assert!(s.is_tab_attached("t1", 5));
}
