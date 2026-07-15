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
