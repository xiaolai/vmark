// WI-P1.1 — the shared driver-authorization gate (`authorize_driver_op`), which
// `browser_eval` and the new `browser_screenshot` both route through. Extracting
// it made the gate unit-testable without a Tauri harness; these tests pin the
// invariants both commands depend on (disabled, stale generation, no committed
// page, per-mode read authority, policy epoch, human attachment consumption).
use super::*;
use crate::browser::one_shot::OneShot;
use crate::browser::registry::AutomationMode;
use crate::command_error::ErrorCode;

/// The MCP token a refusal carries, so these tests assert on the CLASS and on the
/// token shipped clients match — not on prose. Before WI-DP2.3 every assertion
/// here compared an error STRING, which is the wiring-assertion shape
/// `.claude/rules/10-tdd.md` names an anti-pattern: it passed for any reword and
/// could not tell `permission-denied` from `conflict`.
fn mcp_code(err: &crate::command_error::CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("mcpCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

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
    assert_eq!(err.code(), ErrorCode::FeatureDisabled);
    assert_eq!(mcp_code(&err), "BROWSER_DISABLED");
}

#[test]
fn stale_generation_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    // The tab is at generation 0; a command stamped generation 5 is stale.
    let err = authorize_driver_op(&surface, "t", 5, "read", None, None).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
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
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "NO_COMMITTED_PAGE");
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
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "POLICY_STALE");
}

#[test]
fn a_human_tab_read_requires_an_attachment() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
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
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "NOT_GRANTED");
}

/// Grant `ops` on `pattern` to the window `commit_tab` registers its tabs in.
fn grant(surface: &BrowserSurface, pattern: &str, ops: &[&str]) {
    grant_in_window(surface, "main", pattern, ops);
}

/// Grants belong to a WINDOW (audit 20260903 A-03); a tab reads its owner's slice.
fn grant_in_window(surface: &BrowserSurface, window: &str, pattern: &str, ops: &[&str]) {
    surface
        .grants
        .lock()
        .unwrap()
        .entry(window.to_string())
        .or_default()
        .push(crate::browser::origin_guard::StandingGrant {
            origin_pattern: pattern.into(),
            operations: ops.iter().map(|s| s.to_string()).collect(),
        });
}

// Audit 20260903 A-03 — one process-wide grant vector let window B's sync clobber
// window A's grants; now a tab is authorized only by the grants of the window that
// owns it.
#[test]
fn a_tab_is_authorized_only_by_its_own_windows_grants() {
    let surface = enabled_surface();
    {
        let mut reg = surface.registry.lock().unwrap();
        for (tab, window) in [("ta", "a"), ("tb", "b")] {
            reg.create_with_mode(tab, window, AutomationMode::AiSandbox)
                .unwrap();
            reg.begin_navigation(tab, "https://ex.com/").unwrap();
            reg.set_committed_url(tab, "https://ex.com/").unwrap();
            reg.set_policy_epoch(tab, 0).unwrap();
        }
    }
    grant_in_window(&surface, "a", "https://ex.com", &["click"]);

    assert!(
        authorize_driver_op(&surface, "ta", 0, "click", None, None).is_ok(),
        "window A's tab is authorized by window A's grant"
    );
    let err = authorize_driver_op(&surface, "tb", 0, "click", None, None).unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(
        mcp_code(&err),
        "NOT_GRANTED",
        "window B's tab must not be authorized by window A's grant"
    );

    // And granting in B leaves A's authority exactly as it was.
    grant_in_window(&surface, "b", "https://ex.com", &["read"]);
    assert!(authorize_driver_op(&surface, "tb", 0, "read", None, None).is_ok());
    assert!(authorize_driver_op(&surface, "tb", 0, "click", None, None).is_err());
    assert!(authorize_driver_op(&surface, "ta", 0, "click", None, None).is_ok());
}

#[test]
fn a_human_tab_click_needs_an_attachment_even_with_a_standing_grant() {
    // Regression (Audit High): a grant authorizes the OPERATION on the origin, not
    // the human tab's per-view consent. Without an attachment the click is refused.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::Human);
    grant(&surface, "https://ex.com", &["click"]);
    let err = authorize_driver_op(&surface, "t", 0, "click", None, None).unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
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
    let err = authorize_driver_op(&surface, "t", 0, "read", None, None).unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
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
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
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
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "PROFILE_ORIGIN_CONFINED");
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

// WI-1.4 / WI-1.8 — `command_still_fresh`, the post-authorization re-check. It had
// no tests at all, despite being the only thing standing between a long-running
// capture (or a main-thread eval dispatch) and a page that navigated underneath it.
//
// Its contract differs from `authorize_driver_op` in one critical way: it must
// re-verify WITHOUT consuming a one-shot or an attachment. A re-check that spent
// consent would burn the user's "Allow once" on the *second* half of an operation
// they already approved — and then have nothing left for the retry.

#[test]
fn a_fresh_command_is_still_fresh() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    assert!(command_still_fresh(&surface, "t", 0));
}

#[test]
fn freshness_fails_once_the_page_navigates_under_a_running_command() {
    // The WI-1.4 scenario: `takeSnapshot` pumps the run loop for up to ten seconds;
    // pixels captured after a navigation belong to a page the caller was never
    // authorized against.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    {
        let mut reg = surface.registry.lock().unwrap();
        reg.begin_navigation("t", "https://evil.com/").unwrap();
        reg.bump_generation("t").unwrap();
        reg.set_committed_url("t", "https://evil.com/").unwrap();
    }
    assert!(!command_still_fresh(&surface, "t", 0));
}

#[test]
fn freshness_fails_when_the_browser_was_disabled_mid_command() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.ai_policy.lock().unwrap().enabled = false;
    assert!(!command_still_fresh(&surface, "t", 0));
}

#[test]
fn freshness_fails_for_an_unknown_or_destroyed_tab() {
    let surface = enabled_surface();
    assert!(!command_still_fresh(&surface, "ghost", 0));
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.forget_tab("t").unwrap();
    assert!(!command_still_fresh(&surface, "t", 0));
}

#[test]
fn an_ai_tab_goes_stale_when_the_policy_epoch_moves() {
    // Posture changed under the command (sandbox↔shared, or the feature toggled):
    // the authority it was granted under no longer exists.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.ai_policy.lock().unwrap().epoch = 1;
    assert!(!command_still_fresh(&surface, "t", 0));
}

#[test]
fn a_human_tab_is_not_subject_to_the_policy_epoch() {
    // Human tabs are not AI-posture-bound; only the AI lanes carry the epoch.
    let surface = enabled_surface();
    commit_tab(&surface, "h", "https://ex.com/", AutomationMode::Human);
    surface.ai_policy.lock().unwrap().epoch = 7;
    assert!(command_still_fresh(&surface, "h", 0));
}

#[test]
fn the_freshness_recheck_consumes_neither_one_shot_nor_attachment() {
    // The invariant that makes it safe to call twice per command.
    let surface = enabled_surface();
    commit_tab(&surface, "h", "https://ex.com/", AutomationMode::Human);
    surface.attach_tab("h".into(), 0, true).unwrap(); // single-use
    surface.one_shots.lock().unwrap().push(OneShot {
        tab_id: "h".into(),
        generation: 0,
        origin_pattern: "https://ex.com".into(),
        operation: "click".into(),
        target: None,
        payload_hash: None,
    });

    for _ in 0..5 {
        assert!(command_still_fresh(&surface, "h", 0));
    }

    assert!(
        surface.is_tab_attached("h", 0),
        "a single-use attachment must survive repeated freshness checks"
    );
    assert_eq!(
        surface.one_shots.lock().unwrap().len(),
        1,
        "a one-shot must survive repeated freshness checks"
    );
}

// WI-2.1/2.2 — `submit_if_fresh`, the verify-then-enqueue ordering.
//
// This is the test the audit said was missing. The check used to live inline in
// the macOS main-thread closure, which needs a real WKWebView on a real main
// thread — so DELETING it left every test green and the plan's DoD ("a test proves
// the closure observes N+1") was not actually met. Extracting the ordering into a
// pure function makes it provable: these assert on whether the dispatch RAN, so
// removing the freshness check from `dispatch_if_fresh` fails them immediately.

use std::cell::Cell;

#[test]
fn a_fresh_command_submits() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let ran = Cell::new(false);
    let out = submit_if_fresh(&surface, "t", 0, || {
        ran.set(true);
        "result"
    })
    .unwrap();
    assert!(ran.get(), "a fresh command must reach its enqueue");
    assert_eq!(out, "result");
}

#[test]
fn a_stale_generation_never_reaches_the_enqueue() {
    // The invariant: not merely that the call returns Err, but that the side
    // effect NEVER HAPPENS. An eval cannot be undone by a post-check, which is the
    // entire reason the check moved inside the closure.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    {
        let mut reg = surface.registry.lock().unwrap();
        reg.begin_navigation("t", "https://evil.com/").unwrap();
        reg.bump_generation("t").unwrap();
        reg.set_committed_url("t", "https://evil.com/").unwrap();
    }
    let ran = Cell::new(false);
    let err = submit_if_fresh(&surface, "t", 0, || ran.set(true)).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
    assert!(
        !ran.get(),
        "the script ran against a page the command was never authorized for"
    );
}

#[test]
fn a_destroyed_tab_never_reaches_the_enqueue() {
    // [Audit High] SCOPE — an earlier comment here claimed this covered "the
    // cross-thread case". It does not. This arranges stale state BEFORE the call;
    // it never interleaves a mutation between the check and the dispatch, which is
    // the actual race. What these tests prove is that `dispatch_if_fresh` refuses
    // every stale STATE it is given. The residual cross-thread window is documented
    // in `surface_macos::eval` and is NOT covered by any test; closing it needs a
    // barrier-based harness that can mutate state mid-call.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.forget_tab("t").unwrap();
    let ran = Cell::new(false);
    assert!(submit_if_fresh(&surface, "t", 0, || ran.set(true)).is_err());
    assert!(!ran.get(), "dispatched against a destroyed tab");
}

#[test]
fn a_disabled_browser_never_reaches_the_enqueue() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.ai_policy.lock().unwrap().enabled = false;
    let ran = Cell::new(false);
    assert!(submit_if_fresh(&surface, "t", 0, || ran.set(true)).is_err());
    assert!(!ran.get(), "dispatched with the browser switched off");
}

#[test]
fn a_policy_epoch_change_never_reaches_the_enqueue() {
    // Posture changed under the command: the authority it was granted under is gone.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    surface.ai_policy.lock().unwrap().epoch = 1;
    let ran = Cell::new(false);
    assert!(submit_if_fresh(&surface, "t", 0, || ran.set(true)).is_err());
    assert!(!ran.get(), "dispatched under a superseded AI posture");
}

#[test]
fn the_registry_guard_is_released_before_the_caller_awaits() {
    // The guard MUST span the check and the enqueue (see the barrier test), and MUST
    // be gone by the time `submit_if_fresh` returns — because the caller then pumps
    // the run loop, and WebKit callbacks re-enter on the main thread and take this
    // same lock. Holding it across the pump would deadlock.
    //
    // An earlier test here asserted no lock was held DURING dispatch, which was the
    // right property for the old (racy) design and the wrong one for this.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    submit_if_fresh(&surface, "t", 0, || ()).unwrap();
    assert!(
        surface.registry.try_lock().is_ok(),
        "the registry guard outlived submit_if_fresh — the caller's pump would deadlock"
    );
    assert!(
        surface.ai_policy.try_lock().is_ok(),
        "the policy guard outlived submit"
    );
}

// WI-2 (audit round 3) — `submit_if_fresh`: the check and the enqueue are ATOMIC
// against other threads.
//
// The earlier `dispatch_if_fresh` released the registry guard before dispatching,
// so a Tauri command thread could navigate, destroy the tab, or bump the policy
// epoch in the gap. Those tests arranged stale state BEFORE the call and so could
// never observe that window — an audit was right to call the "cross-thread case"
// claim wrong. These use a real second thread and a barrier.

use std::sync::mpsc;
use std::sync::Arc;

#[test]
fn a_concurrent_mutation_cannot_land_between_the_check_and_the_submit() {
    let surface = Arc::new(enabled_surface());
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);

    // `inside` fires once submit begins; `release` unblocks it. Between those two
    // points a second thread tries to invalidate the command.
    let (inside_tx, inside_rx) = mpsc::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();

    let mutator = {
        let surface = Arc::clone(&surface);
        std::thread::spawn(move || {
            // Wait until the submit is genuinely in flight.
            inside_rx.recv().expect("submit never started");
            // Try to invalidate. This BLOCKS on the registry lock the submitter
            // holds — which is the property under test. If the lock were released
            // before submit (the old behaviour), this would succeed mid-flight.
            {
                let mut reg = surface.registry.lock().unwrap();
                reg.bump_generation("t").unwrap();
            }
            release_tx.send(()).ok();
        })
    };

    let observed_generation = submit_if_fresh(&surface, "t", 0, || {
        inside_tx.send(()).ok();
        // Give the mutator a real chance to interleave. If it could, the registry
        // would show generation 1 by the time we read it here.
        std::thread::sleep(std::time::Duration::from_millis(150));
        surface.registry.try_lock().map(|r| r.generation("t")).ok()
    })
    .expect("a fresh command must submit");

    let _ = release_rx.recv_timeout(std::time::Duration::from_secs(5));
    mutator.join().unwrap();

    // Inside the submit, the registry lock is HELD by us — so a try_lock from the
    // same thread fails, proving the guard spans the enqueue. (A re-entrant lock
    // would be a different bug; std Mutex is not reentrant, so try_lock failing is
    // exactly the evidence we want.)
    assert!(
        observed_generation.is_none(),
        "the registry guard was NOT held across submit — a concurrent thread could \
         have invalidated the command between the freshness check and the enqueue"
    );

    // And the mutation did land afterwards, proving the mutator really ran rather
    // than the test passing because nothing happened.
    assert_eq!(
        surface.registry.lock().unwrap().generation("t"),
        Some(1),
        "the concurrent mutation never applied — the barrier did not exercise the race"
    );
}

#[test]
fn submit_if_fresh_refuses_a_stale_command_without_submitting() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    {
        let mut reg = surface.registry.lock().unwrap();
        reg.bump_generation("t").unwrap();
    }
    let submitted = Cell::new(false);
    let err = submit_if_fresh(&surface, "t", 0, || submitted.set(true)).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
    assert!(!submitted.get(), "a stale command reached the enqueue");
}
