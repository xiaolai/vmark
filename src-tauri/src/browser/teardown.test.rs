//! WI-S0.4 — window-destroy teardown.
//!
//! React's cleanup IPC is not dependable once the owning webview is closing: the very
//! thing that would send `browser_destroy` is being torn down. So closing a window used
//! to leave its native WKWebViews alive — orphaned content processes, still holding the
//! page, with nothing left that could ever reach them.

use super::*;
use crate::browser::registry::BrowserRegistry;

fn registry_with(tabs: &[(&str, &str)]) -> BrowserRegistry {
    let mut r = BrowserRegistry::default();
    for (tab, window) in tabs {
        r.create(tab, window).expect("create");
    }
    r
}

#[test]
fn forgets_every_tab_belonging_to_the_closed_window() {
    let mut reg = registry_with(&[("t1", "main"), ("t2", "main")]);
    let dropped = forget_window_tabs(&mut reg, "main");
    assert_eq!(dropped.len(), 2);
    assert!(!reg.contains("t1"));
    assert!(!reg.contains("t2"));
}

#[test]
fn leaves_other_windows_tabs_alone() {
    let mut reg = registry_with(&[("t1", "main"), ("t2", "doc-2")]);
    let dropped = forget_window_tabs(&mut reg, "main");
    assert_eq!(dropped, vec!["t1".to_string()]);
    assert!(!reg.contains("t1"));
    assert!(reg.contains("t2"), "another window's tab must survive");
}

#[test]
fn closing_a_window_with_no_browser_tabs_is_a_no_op() {
    let mut reg = registry_with(&[("t1", "main")]);
    let dropped = forget_window_tabs(&mut reg, "doc-9");
    assert!(dropped.is_empty());
    assert!(reg.contains("t1"));
}

#[test]
fn returns_the_tabs_so_the_caller_can_tear_down_their_native_views() {
    // The registry is only half the job: each returned id still owns a live WKWebView
    // and a parked-dialog queue. The caller destroys those; this asserts it is TOLD
    // which ones, rather than having to rediscover them after the entry is gone.
    let mut reg = registry_with(&[("t1", "main")]);
    let dropped = forget_window_tabs(&mut reg, "main");
    assert_eq!(dropped, vec!["t1".to_string()]);
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
