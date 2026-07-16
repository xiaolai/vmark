// WI-P1.1 — the shared driver-authorization gate (`authorize_driver_op`), which
// `browser_eval` and the new `browser_screenshot` both route through. Extracting
// it made the gate unit-testable without a Tauri harness; these tests pin the
// invariants both commands depend on (disabled, stale generation, no committed
// page, per-mode read authority, policy epoch, human attachment consumption).
use super::*;
use crate::browser::one_shot::OneShot;
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
    let err = authorize_driver_op(&surface, "no-such-tab", 0, "read", None, None).unwrap_err();
    assert_eq!(err, "BROWSER_DISABLED");
}

#[test]
fn stale_generation_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // The tab is at generation 0; a command stamped generation 5 is stale.
    let err = authorize_driver_op(&surface, "t", 5, "read", None, None).unwrap_err();
    assert!(err.contains("stale command"), "got: {err}");
}

#[test]
fn a_tab_with_no_committed_page_grants_nothing() {
    let surface = enabled_surface();
    {
        // Navigating but never committed: executable + fresh, yet no origin.
        let mut reg = surface.registry.lock().unwrap();
        reg.create_with_mode("t", "main", AutomationMode::AiSandbox)
            .unwrap();
        reg.begin_navigation("t", "https://ex.com/").unwrap();
        reg.set_policy_epoch("t", 0).unwrap();
    }
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert!(err.contains("no committed page"), "got: {err}");
}

#[test]
fn ai_sandbox_may_read_its_own_committed_page() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    assert!(authorize_driver_op(&surface, "t", 0, "read", None, None).is_ok());
}

#[test]
fn ai_sandbox_read_is_refused_when_the_policy_epoch_moved() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // The policy epoch advanced (a posture change) but the tab still carries the
    // old one: its authority is stale.
    surface.ai_policy.lock().unwrap().epoch = 1;
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert_eq!(err, "POLICY_STALE");
}

#[test]
fn a_human_tab_read_requires_an_attachment() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert_eq!(err, "ATTACHMENT_REQUIRED");
}

#[test]
fn a_human_tab_read_with_an_attachment_is_allowed_and_consumes_it() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    surface.attach_tab("t".into(), 0, true).unwrap();

    assert!(authorize_driver_op(&surface, "t", 0, "read", None, None).is_ok());
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
    let err = authorize_driver_op(&surface, "t", 0, "frobnicate", None, None).unwrap_err();
    assert!(err.contains("not granted"), "got: {err}");
}

fn grant(surface: &BrowserSurface, pattern: &str, ops: &[&str]) {
    surface
        .grants
        .lock()
        .unwrap()
        .push(crate::browser::origin_guard::StandingGrant {
            origin_pattern: pattern.into(),
            operations: ops.iter().map(|s| s.to_string()).collect(),
        });
}

#[test]
fn a_human_tab_click_needs_an_attachment_even_with_a_standing_grant() {
    // Regression (Audit High): a grant authorizes the OPERATION on the origin, not
    // the human tab's per-view consent. Without an attachment the click is refused.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    grant(&surface, "https://ex.com", &["click"]);
    let err = authorize_driver_op(&surface, "t", 0, "click", None, None).unwrap_err();
    assert_eq!(err, "ATTACHMENT_REQUIRED");
}

#[test]
fn a_human_tab_click_with_grant_and_attachment_is_allowed_and_consumes_the_attachment() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    grant(&surface, "https://ex.com", &["click"]);
    surface.attach_tab("t".into(), 0, true).unwrap();
    assert!(authorize_driver_op(&surface, "t", 0, "click", None, None).is_ok());
    assert!(!surface.is_tab_attached("t", 0));
}

#[test]
fn a_single_use_attachment_authorizes_exactly_one_operation() {
    // Sequential proxy for the concurrent race (Audit High): the atomic consume
    // means a one-use attachment can be spent only once; the next call is refused.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    surface.attach_tab("t".into(), 0, true).unwrap();
    assert!(authorize_driver_op(&surface, "t", 0, "read", None, None).is_ok());
    assert_eq!(
        authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err(),
        "ATTACHMENT_REQUIRED"
    );
}

#[test]
fn ai_sandbox_click_is_authorized_by_a_standing_grant() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    grant(&surface, "https://ex.com", &["click"]);
    assert!(authorize_driver_op(&surface, "t", 0, "click", None, None).is_ok());
}

#[test]
fn a_one_shot_binds_to_its_exact_target_and_a_mismatch_does_not_spend_it() {
    // A one-shot for "click Publish" must not authorize "click Delete", and a
    // failed match must leave the one-shot unspent for the intended action.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.one_shots.lock().unwrap().push(OneShot {
        tab_id: "t".into(),
        generation: 0,
        origin_pattern: "https://ex.com".into(),
        operation: "click".into(),
        target: Some(OneShotTarget {
            role: "button".into(),
            name: "Publish".into(),
        }),
        payload_hash: None,
    });
    let wrong = OneShotTarget {
        role: "button".into(),
        name: "Delete".into(),
    };
    assert!(authorize_driver_op(&surface, "t", 0, "click", Some(&wrong), None).is_err());
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        1,
        "mismatch must not spend it"
    );

    let right = OneShotTarget {
        role: "button".into(),
        name: "Publish".into(),
    };
    assert!(authorize_driver_op(&surface, "t", 0, "click", Some(&right), None).is_ok());
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        0,
        "exact match consumes it"
    );
}

#[test]
fn a_human_tab_without_attachment_does_not_burn_a_one_shot() {
    // Invariant (Audit round 2): the attachment is required before any one-shot is
    // spent, so a human-tab op refused for lack of an attachment must NOT consume
    // the one-shot it would otherwise use — no consent/token burned on a denial.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    surface.one_shots.lock().unwrap().push(OneShot {
        tab_id: "t".into(),
        generation: 0,
        origin_pattern: "https://ex.com".into(),
        operation: "click".into(),
        target: None,
        payload_hash: None,
    });
    let err = authorize_driver_op(&surface, "t", 0, "click", None, None).unwrap_err();
    assert_eq!(err, "ATTACHMENT_REQUIRED");
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        1,
        "one-shot must be untouched"
    );
}

#[test]
fn a_human_tab_click_via_one_shot_and_attachment_consumes_both() {
    // The two-resource happy path: a human tab with BOTH a matching one-shot and an
    // attachment is authorized and spends both.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    surface.one_shots.lock().unwrap().push(OneShot {
        tab_id: "t".into(),
        generation: 0,
        origin_pattern: "https://ex.com".into(),
        operation: "click".into(),
        target: None,
        payload_hash: None,
    });
    surface.attach_tab("t".into(), 0, true).unwrap();
    assert!(authorize_driver_op(&surface, "t", 0, "click", None, None).is_ok());
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        0,
        "one-shot consumed"
    );
    assert!(!surface.is_tab_attached("t", 0), "attachment consumed");
}

#[test]
fn a_profile_confined_read_off_origin_is_denied_even_with_a_read_one_shot() {
    // WI-P6.1 H1 (re-verify round 2): once a profile-backed tab leaves its approved
    // origin, a read is HARD-denied — a one-shot must not rescue it, and must not be
    // spent on the denial (the page carries the profile's login).
    let surface = enabled_surface();
    // Approved origin is github.com, but the tab committed at evil.com (a redirect).
    commit_tab(
        &surface,
        "t",
        "https://evil.com/",
        AutomationMode::AiSandbox,
    );
    surface
        .registry
        .lock()
        .unwrap()
        .set_profile_origin("t", "https://github.com/login")
        .unwrap();
    surface.one_shots.lock().unwrap().push(OneShot {
        tab_id: "t".into(),
        generation: 0,
        origin_pattern: "https://evil.com".into(),
        operation: "read".into(),
        target: None,
        payload_hash: None,
    });
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert_eq!(err, "PROFILE_ORIGIN_CONFINED");
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        1,
        "the read one-shot must NOT be spent on a confinement denial"
    );
}

#[test]
fn a_profile_confined_read_on_the_approved_origin_is_allowed() {
    let surface = enabled_surface();
    commit_tab(
        &surface,
        "t",
        "https://github.com/account",
        AutomationMode::AiSandbox,
    );
    surface
        .registry
        .lock()
        .unwrap()
        .set_profile_origin("t", "https://github.com/login")
        .unwrap();
    // Same origin as approved → the ordinary sandbox auto-read applies.
    assert!(authorize_driver_op(&surface, "t", 0, "read", None, None).is_ok());
}
