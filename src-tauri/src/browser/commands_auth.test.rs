// WI-P1.1 — the shared driver-authorization gate (`authorize_driver_op`), which
// `browser_eval` and the new `browser_screenshot` both route through. Extracting
// it made the gate unit-testable without a Tauri harness; these tests pin the
// invariants both commands depend on (disabled, stale generation, no committed
// page, per-mode read authority, policy epoch, human attachment consumption).
use super::*;
use crate::browser::registry::AutomationMode;

fn enabled_surface() -> BrowserSurface {
    let surface = BrowserSurface::default();
    {
        let mut policy = surface.ai_policy.lock().unwrap();
        policy.enabled = true;
        policy.epoch = 0;
    }
    surface
}

/// Register a tab, drive it to a committed page at generation 0, and stamp the
/// current policy epoch — the state a real driver command authorizes against.
fn commit_tab(surface: &BrowserSurface, tab_id: &str, url: &str, mode: AutomationMode) {
    let mut reg = surface.registry.lock().unwrap();
    reg.create_with_mode(tab_id, "main", mode).unwrap();
    reg.begin_navigation(tab_id, url).unwrap();
    reg.set_committed_url(tab_id, url).unwrap();
    reg.set_policy_epoch(tab_id, 0).unwrap();
}

#[test]
fn disabled_browser_refuses_before_touching_the_registry() {
    let surface = BrowserSurface::default(); // policy.enabled defaults to false
    let err = authorize_driver_op(&surface, "no-such-tab", 0, "read", None).unwrap_err();
    assert_eq!(err, "BROWSER_DISABLED");
}

#[test]
fn stale_generation_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // The tab is at generation 0; a command stamped generation 5 is stale.
    let err = authorize_driver_op(&surface, "t", 5, "read", None).unwrap_err();
    assert!(err.contains("stale command"), "got: {err}");
}

#[test]
fn a_tab_with_no_committed_page_grants_nothing() {
    let surface = enabled_surface();
    {
        // Navigating but never committed: executable + fresh, yet no origin.
        let mut reg = surface.registry.lock().unwrap();
        reg.create_with_mode("t", "main", AutomationMode::AiSandbox).unwrap();
        reg.begin_navigation("t", "https://ex.com/").unwrap();
        reg.set_policy_epoch("t", 0).unwrap();
    }
    let err = authorize_driver_op(&surface, "t", 0, "read", None).unwrap_err();
    assert!(err.contains("no committed page"), "got: {err}");
}

#[test]
fn ai_sandbox_may_read_its_own_committed_page() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    assert!(authorize_driver_op(&surface, "t", 0, "read", None).is_ok());
}

#[test]
fn ai_sandbox_read_is_refused_when_the_policy_epoch_moved() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // The policy epoch advanced (a posture change) but the tab still carries the
    // old one: its authority is stale.
    surface.ai_policy.lock().unwrap().epoch = 1;
    let err = authorize_driver_op(&surface, "t", 0, "read", None).unwrap_err();
    assert_eq!(err, "POLICY_STALE");
}

#[test]
fn a_human_tab_read_requires_an_attachment() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    let err = authorize_driver_op(&surface, "t", 0, "read", None).unwrap_err();
    assert_eq!(err, "ATTACHMENT_REQUIRED");
}

#[test]
fn a_human_tab_read_with_an_attachment_is_allowed_and_consumes_it() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    surface.attach_tab("t".into(), 0, true).unwrap();

    assert!(authorize_driver_op(&surface, "t", 0, "read", None).is_ok());
    // A one-shot attachment is spent by the authorized read — the next read must
    // require a fresh attachment.
    assert!(!surface.is_tab_attached("t", 0));
}

#[test]
fn an_unknown_operation_is_refused_even_on_an_ai_owned_tab() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // Screenshot authorizes as "read"; a bogus operation string has no grant and
    // no one-shot, so it is refused rather than treated as an opaque permission.
    let err = authorize_driver_op(&surface, "t", 0, "frobnicate", None).unwrap_err();
    assert!(err.contains("not granted"), "got: {err}");
}
