//! WI-S0.4 — window-destroy teardown.
//!
//! React's cleanup IPC is not dependable once the owning webview is closing: the very
//! thing that would send `browser_destroy` is being torn down. So closing a window used
//! to leave its native WKWebViews alive — orphaned content processes, still holding the
//! page, with nothing left that could ever reach them.

use super::*;
use crate::browser::recovery::MAX_AUTO_RELOADS;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

fn surface_with(tabs: &[(&str, &str)]) -> BrowserSurface {
    let s = BrowserSurface::default();
    {
        let mut reg = s.registry.lock().unwrap();
        for (tab, window) in tabs {
            reg.create(tab, window).expect("create");
        }
    }
    s
}

fn contains(s: &BrowserSurface, tab_id: &str) -> bool {
    s.registry.lock().unwrap().contains(tab_id)
}

#[test]
fn forgets_every_tab_belonging_to_the_closed_window() {
    let s = surface_with(&[("t1", "main"), ("t2", "main")]);
    let dropped = forget_window(&s, "main").unwrap();
    assert_eq!(dropped.len(), 2);
    assert!(!contains(&s, "t1"));
    assert!(!contains(&s, "t2"));
}

#[test]
fn leaves_other_windows_tabs_alone() {
    let s = surface_with(&[("t1", "main"), ("t2", "doc-2")]);
    s.attach_tab("t2".into(), 0, true).unwrap();
    let dropped = forget_window(&s, "main").unwrap();
    assert_eq!(dropped, vec!["t1".to_string()]);
    assert!(!contains(&s, "t1"));
    assert!(contains(&s, "t2"), "another window's tab must survive");
    assert!(s.is_tab_attached("t2", 0), "and so must its attachment");
}

#[test]
fn closing_a_window_with_no_browser_tabs_is_a_no_op() {
    let s = surface_with(&[("t1", "main")]);
    let dropped = forget_window(&s, "doc-9").unwrap();
    assert!(dropped.is_empty());
    assert!(contains(&s, "t1"));
}

#[test]
fn returns_the_tabs_so_the_caller_can_tear_down_their_native_views() {
    // The registry is only half the job: each returned id still owns a live WKWebView
    // and a parked-dialog queue. The caller destroys those; this asserts it is TOLD
    // which ones, rather than having to rediscover them after the entry is gone.
    let s = surface_with(&[("t1", "main")]);
    let dropped = forget_window(&s, "main").unwrap();
    assert_eq!(dropped, vec!["t1".to_string()]);
}

// Audit 20260903 round 4, #35 — a closing window's tabs lose EVERY piece of
// tab-scoped state, and lose it under the registry guard.

#[test]
fn a_closed_windows_tabs_lose_their_attachment_one_shots_and_crash_budget() {
    let s = surface_with(&[("t1", "main"), ("t2", "main")]);
    s.attach_tab("t1".into(), 0, false).unwrap();
    s.attach_tab("t2".into(), 0, true).unwrap();
    {
        let mut trackers = s.crash_trackers.lock().unwrap();
        for tab in ["t1", "t2"] {
            let t = trackers.entry(tab.into()).or_default();
            for _ in 0..=MAX_AUTO_RELOADS {
                t.on_crash();
            }
        }
    }
    s.one_shots
        .lock()
        .unwrap()
        .push(crate::browser::one_shot::OneShot {
            tab_id: "t1".into(),
            generation: 0,
            origin_pattern: "https://ex.com".into(),
            operation: "click".into(),
            target: None,
            payload_hash: None,
        });

    forget_window(&s, "main").unwrap();

    for tab in ["t1", "t2"] {
        assert!(!s.is_tab_attached(tab, 0), "{tab} attachment survived");
        assert!(
            !s.crash_trackers.lock().unwrap().contains_key(tab),
            "{tab} crash budget survived"
        );
    }
    assert!(
        s.one_shots.lock().unwrap().is_empty(),
        "a one-shot survived"
    );
    // The id's next tenant starts clean, exactly as after `forget_tab`.
    s.registry.lock().unwrap().create("t1", "main").unwrap();
    assert!(!s.is_tab_attached("t1", 0));
    assert_eq!(
        s.crash_trackers
            .lock()
            .unwrap()
            .entry("t1".into())
            .or_default()
            .consecutive(),
        0
    );
}

#[test]
fn forget_window_holds_the_registry_guard_across_every_tabs_cleanup() {
    // The bug: destroy_window removed the entries under the registry guard, released
    // it, and only then cleared each tab's one-shots, attachment and crash tracker —
    // a window in which the id could be re-created and re-attached, and this cleanup
    // would then erase the NEW tab's attachment. Same shape as the `forget_tab` test
    // in surface.test.rs: block the last step and look at the registry.
    let s = Arc::new(surface_with(&[("t1", "main"), ("t2", "main")]));
    s.attach_tab("t1".into(), 0, false).unwrap();
    // Hold the ATTACHMENTS lock so forget_window blocks inside its first tab's cleanup.
    let attachments = s.attachments.lock().unwrap();
    let (done_tx, done_rx) = mpsc::channel::<Result<Vec<String>, String>>();
    let worker = {
        let s = Arc::clone(&s);
        thread::spawn(move || done_tx.send(forget_window(&s, "main")).unwrap())
    };
    // Wait until the worker holds the registry: it has removed an entry and is
    // blocked on the attachments we hold.
    let deadline = Instant::now() + Duration::from_secs(5);
    while s.registry.try_lock().is_ok() {
        assert!(
            Instant::now() < deadline,
            "forget_window never took the registry guard"
        );
        thread::sleep(Duration::from_millis(5));
    }
    assert!(
        done_rx.try_recv().is_err(),
        "forget_window finished without the attachments lock"
    );
    // The property under test: blocked on the attachments, forget_window is STILL
    // holding the registry, so no create or attach for these ids can run in the gap.
    assert!(
        s.registry.try_lock().is_err(),
        "the registry guard was released before the per-tab cleanup"
    );
    drop(attachments);
    let mut dropped = done_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("forget completes once the attachments lock is free")
        .unwrap();
    worker.join().unwrap();
    dropped.sort();
    assert_eq!(dropped, vec!["t1".to_string(), "t2".to_string()]);
    assert!(!s.is_tab_attached("t1", 0));
    assert!(s.registry.lock().unwrap().is_empty());
    assert!(s.registry.try_lock().is_ok(), "every guard released");
}

// Audit 20260903 A-03 — grants are the window's, so they die with the window.
#[test]
fn closing_a_window_drops_its_standing_grants_and_no_other_windows() {
    use crate::browser::origin_guard::StandingGrant;
    let grant = |origin: &str| StandingGrant {
        origin_pattern: origin.into(),
        operations: vec!["click".into()],
    };
    let mut grants = HashMap::new();
    grants.insert("main".to_string(), vec![grant("https://a.com")]);
    grants.insert("doc-2".to_string(), vec![grant("https://b.com")]);

    assert!(forget_window_grants(&mut grants, "main"));
    assert!(
        !grants.contains_key("main"),
        "the closed window's slice is gone"
    );
    assert_eq!(
        grants.get("doc-2").map(Vec::len),
        Some(1),
        "another window's grants must survive"
    );
    // A window that never synced: nothing to drop, and saying so is not an error.
    assert!(!forget_window_grants(&mut grants, "doc-9"));
}
