//! Audit 20260903 round 3 (#2, #3, #4) — the transactions behind
//! `browser_ai_create` / `browser_ai_navigate`, each testable against a plain
//! `BrowserSurface` (no Tauri app).

use super::*;
use crate::browser::profile_open::ProfileOpen;
use crate::browser::registry::{Lifecycle, MAX_AI_TABS};
use crate::command_error::ErrorCode;

fn mcp_code(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("mcpCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn kind(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn request<'a>(window: &'a str, url: &'a str) -> AiTabRequest<'a> {
    AiTabRequest {
        window_label: window,
        mode: AutomationMode::AiSandbox,
        url,
        profile: None,
        policy_epoch: 2,
    }
}

// ------------------------------------------------------------- reserve_ai_tab

#[test]
fn reserving_a_fresh_tab_registers_it_at_the_requests_epoch() {
    let state = BrowserSurface::default();
    let outcome = reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap();
    assert_eq!(outcome, AiReservation::Reserved);
    let reg = state.registry.lock().unwrap();
    assert_eq!(reg.state("t"), Some(Lifecycle::Creating));
    assert_eq!(reg.policy_epoch("t"), Some(2));
    assert_eq!(reg.window_of("t"), Some("main"));
}

#[test]
fn the_same_request_resumes_a_bare_reservation_and_is_idempotent_after_begin() {
    let state = BrowserSurface::default();
    let req = request("main", "https://a.example/");
    reserve_ai_tab(&state, "t", &req).unwrap();
    assert_eq!(
        reserve_ai_tab(&state, "t", &req).unwrap(),
        AiReservation::Resumed { generation: 0 }
    );
    let (ticket, _) = begin_ai_navigation(&state, "t", "https://a.example/", req.mode).unwrap();
    assert_eq!(
        reserve_ai_tab(&state, "t", &req).unwrap(),
        AiReservation::Existing {
            navigation_id: ticket.id
        }
    );
}

#[test]
fn a_retry_that_is_not_the_reserving_request_is_a_conflict_naming_the_kind() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("a", "https://a.example/")).unwrap();
    for (req, expected_kind) in [
        (request("b", "https://a.example/"), "window"),
        (request("a", "https://b.example/"), "url"),
        (
            AiTabRequest {
                profile: Some("work"),
                ..request("a", "https://a.example/")
            },
            "profile",
        ),
    ] {
        let err = reserve_ai_tab(&state, "t", &req).unwrap_err();
        assert_eq!(err.code(), ErrorCode::Conflict, "{expected_kind}");
        assert_eq!(mcp_code(&err), "TAB_REQUEST_MISMATCH", "{expected_kind}");
        assert_eq!(kind(&err), expected_kind);
        assert!(
            !err.code().is_retryable(),
            "no approval lifts a mismatched request — the client opens a fresh tab"
        );
    }
    // Nothing about the reservation changed.
    let reg = state.registry.lock().unwrap();
    assert_eq!(reg.window_of("t"), Some("a"));
    assert_eq!(reg.navigation_ticket("t"), None);
}

#[test]
fn a_create_for_a_tab_that_has_navigated_elsewhere_does_not_get_its_ticket() {
    let state = BrowserSurface::default();
    let req = request("main", "https://a.example/");
    reserve_ai_tab(&state, "t", &req).unwrap();
    begin_ai_navigation(&state, "t", "https://a.example/", req.mode).unwrap();
    begin_ai_navigation(&state, "t", "https://elsewhere.example/", req.mode).unwrap();
    let err = reserve_ai_tab(&state, "t", &req).unwrap_err();
    assert_eq!(mcp_code(&err), "TAB_REQUEST_MISMATCH");
    assert_eq!(kind(&err), "navigation");
}

#[test]
fn a_different_mode_is_the_provenance_conflict() {
    let state = BrowserSurface::default();
    reserve_ai_tab(
        &state,
        "t",
        &AiTabRequest {
            mode: AutomationMode::AiShared,
            ..request("main", "https://a.example/")
        },
    )
    .unwrap();
    let err = reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "TAB_PROVENANCE_MISMATCH");
    // A human tab's id is a provenance mismatch too.
    state.registry.lock().unwrap().create("h", "main").unwrap();
    let err = reserve_ai_tab(&state, "h", &request("main", "https://a.example/")).unwrap_err();
    assert_eq!(mcp_code(&err), "TAB_PROVENANCE_MISMATCH");
}

#[test]
fn a_stale_epoch_is_policy_stale_and_checked_before_identity() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap();
    // Another epoch AND another window: the posture conflict is what is reported —
    // the client re-reads the policy and retries, and must not be shown a prompt.
    let err = reserve_ai_tab(
        &state,
        "t",
        &AiTabRequest {
            policy_epoch: 3,
            ..request("other", "https://a.example/")
        },
    )
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "POLICY_STALE");
}

#[test]
fn the_ai_tab_cap_refuses_a_new_id_but_still_resumes_an_existing_one() {
    let state = BrowserSurface::default();
    for i in 0..MAX_AI_TABS {
        let id = format!("t{i}");
        reserve_ai_tab(&state, &id, &request("main", "https://a.example/")).unwrap();
    }
    let err =
        reserve_ai_tab(&state, "one-more", &request("main", "https://a.example/")).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "TAB_LIMIT");
    assert!(
        state
            .registry
            .lock()
            .unwrap()
            .tab_status("one-more")
            .is_none(),
        "a refused reservation leaves no entry"
    );
    // Capacity is about NEW ids: the approval-retry of an existing reservation is
    // not a new tab.
    assert_eq!(
        reserve_ai_tab(&state, "t0", &request("main", "https://a.example/")).unwrap(),
        AiReservation::Resumed { generation: 0 }
    );
}

#[test]
fn a_terminal_entry_is_reported_as_not_found() {
    let state = BrowserSurface::default();
    let req = request("main", "https://a.example/");
    reserve_ai_tab(&state, "t", &req).unwrap();
    state
        .registry
        .lock()
        .unwrap()
        .transition("t", Lifecycle::Destroyed)
        .unwrap();
    let err = reserve_ai_tab(&state, "t", &req).unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(mcp_code(&err), "TAB_NOT_FOUND");
}

// -------------------------------------------------------- begin_ai_navigation

#[test]
fn shared_posture_records_the_destination_approval_with_the_ticket() {
    let state = BrowserSurface::default();
    reserve_ai_tab(
        &state,
        "t",
        &AiTabRequest {
            mode: AutomationMode::AiShared,
            ..request("main", "https://a.example/")
        },
    )
    .unwrap();
    let (ticket, replaced) = begin_ai_navigation(
        &state,
        "t",
        "https://a.example/page",
        AutomationMode::AiShared,
    )
    .unwrap();
    let reg = state.registry.lock().unwrap();
    assert_eq!(
        reg.navigation_ticket("t").map(|t| t.id.as_str()),
        Some(ticket.id.as_str())
    );
    assert!(reg.shared_navigation_approved("t", "https://a.example/other"));
    assert!(!reg.shared_navigation_approved("t", "https://evil.example/"));
    assert_eq!(replaced.state, Lifecycle::Creating);
    assert_eq!(replaced.shared_origin, None, "nothing was approved before");
}

#[test]
fn sandbox_posture_records_no_shared_approval() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap();
    begin_ai_navigation(&state, "t", "https://a.example/", AutomationMode::AiSandbox).unwrap();
    assert!(!state
        .registry
        .lock()
        .unwrap()
        .shared_navigation_approved("t", "https://a.example/"));
}

#[test]
fn beginning_on_an_unknown_tab_is_the_registrys_refusal() {
    let state = BrowserSurface::default();
    let err = begin_ai_navigation(
        &state,
        "ghost",
        "https://a.example/",
        AutomationMode::AiSandbox,
    )
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
}

// ---------------------------------------------------------- authorize_profile

fn grant_profile(state: &BrowserSurface, profile: &str, origin_pattern: &str) {
    state.profile_opens.lock().unwrap().push(ProfileOpen {
        profile: profile.into(),
        origin_pattern: origin_pattern.into(),
    });
}

// Round 3 follow-up — the posture the DRIVER observes decides, and a profile it
// cannot honour is refused rather than dropped.
#[test]
fn a_profile_asked_for_under_the_shared_posture_is_refused_not_silently_dropped() {
    let err = profile_for_mode(AutomationMode::AiShared, Some("work".into())).unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "PROFILE_REQUIRES_SANDBOX");
    assert_eq!(
        err.detail().and_then(|d| d.get("profile")),
        Some(&serde_json::json!("work")),
        "the client is told which profile it asked for"
    );
    // Human posture cannot reach this command, but the rule is about the mode.
    assert!(profile_for_mode(AutomationMode::Human, Some("work".into())).is_err());
}

#[test]
fn the_sandbox_posture_keeps_its_profile_and_no_profile_is_always_fine() {
    assert_eq!(
        profile_for_mode(AutomationMode::AiSandbox, Some("work".into())).unwrap(),
        Some("work".into())
    );
    for mode in [
        AutomationMode::AiSandbox,
        AutomationMode::AiShared,
        AutomationMode::Human,
    ] {
        assert_eq!(profile_for_mode(mode, None).unwrap(), None, "{mode:?}");
    }
}

#[test]
fn a_sandbox_profile_with_a_matching_grant_is_consumed_and_pins_the_origin() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://github.com/login")).unwrap();
    grant_profile(&state, "work", "https://github.com");
    let applied =
        authorize_profile(&state, "t", Some("work".into()), "https://github.com/login").unwrap();
    assert_eq!(applied.as_deref(), Some("work"));
    assert!(
        state.profile_opens.lock().unwrap().is_empty(),
        "single-use: the grant is spent"
    );
    let reg = state.registry.lock().unwrap();
    assert!(reg.profile_read_allowed("t", "https://github.com/account"));
    assert!(
        !reg.profile_read_allowed("t", "https://evil.com/"),
        "read confinement pinned to the approved origin (WI-P6.1 H1)"
    );
}

#[test]
fn without_a_grant_the_reservation_is_forgotten_and_the_profile_never_applied() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://github.com/")).unwrap();
    // A grant for another profile, and one for another origin: neither matches.
    grant_profile(&state, "personal", "https://github.com");
    grant_profile(&state, "work", "https://gitlab.com");
    let err =
        authorize_profile(&state, "t", Some("work".into()), "https://github.com/").unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "PROFILE_NOT_APPROVED");
    assert!(
        state.registry.lock().unwrap().tab_status("t").is_none(),
        "the reserved entry is gone — a retried id starts clean"
    );
    assert_eq!(
        state.profile_opens.lock().unwrap().len(),
        2,
        "no unrelated grant was spent"
    );
}

#[test]
fn a_profile_less_creation_consumes_nothing_and_pins_nothing() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://github.com/")).unwrap();
    grant_profile(&state, "work", "https://github.com");
    assert_eq!(
        authorize_profile(&state, "t", None, "https://github.com/").unwrap(),
        None
    );
    assert_eq!(
        state.profile_opens.lock().unwrap().len(),
        1,
        "an unrelated grant is left for the request that asks for it"
    );
    assert!(
        state
            .registry
            .lock()
            .unwrap()
            .profile_read_allowed("t", "https://anything.example/"),
        "no confinement pinned"
    );
}

// --------------------------------------------------- create_native / navigate

#[test]
fn a_failed_native_creation_forgets_the_tab_and_classifies_the_failure() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap();
    state
        .crash_trackers
        .lock()
        .unwrap()
        .entry("t".into())
        .or_default();
    let err = create_native(&state, "t", || Err("WINDOW_GONE: no such window".into())).unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(kind(&err), "window-gone");
    assert!(state.registry.lock().unwrap().tab_status("t").is_none());
    assert!(
        !state.crash_trackers.lock().unwrap().contains_key("t"),
        "every half of the tab's state goes"
    );
}

#[test]
fn a_successful_creation_leaves_the_reservation_in_place() {
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://a.example/")).unwrap();
    let mut ran = false;
    create_native(&state, "t", || {
        ran = true;
        Ok(())
    })
    .unwrap();
    assert!(ran);
    assert!(state.registry.lock().unwrap().tab_status("t").is_some());
}

/// A live tab on a committed page, the state a navigate command starts from.
fn live_tab(state: &BrowserSurface, url: &str) {
    reserve_ai_tab(state, "t", &request("main", url)).unwrap();
    let mut reg = state.registry.lock().unwrap();
    reg.begin_navigation("t", url).unwrap();
    reg.transition("t", Lifecycle::Live).unwrap();
    reg.set_committed_url("t", url).unwrap();
}

#[test]
fn a_failed_native_navigation_restores_the_state_the_begin_replaced() {
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let before = state.registry.lock().unwrap().tab_status("t").unwrap();
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let err = navigate_native(&state, "t", &ticket, replaced, || {
        Err("NO_WEBVIEW: no webview: t".into())
    })
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    let reg = state.registry.lock().unwrap();
    assert_eq!(reg.tab_status("t").unwrap(), before, "put back exactly");
    assert_eq!(reg.committed_url("t"), Some("https://a.example/"));
}

#[test]
fn a_failure_after_a_concurrent_navigation_leaves_the_newer_navigation_in_force() {
    // Audit round 3, #4: N1's native call fails AFTER N2 has begun. N1's rollback
    // must not put page A back under N2's in-flight load.
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let (n1, replaced_by_n1) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let (n2, _) =
        begin_ai_navigation(&state, "t", "https://c.example/", AutomationMode::AiSandbox).unwrap();
    let err = navigate_native(&state, "t", &n1, replaced_by_n1, || {
        Err("MAIN_THREAD_TIMEOUT: x".into())
    })
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Timeout);
    let reg = state.registry.lock().unwrap();
    assert_eq!(
        reg.navigation_ticket("t").map(|t| t.id.as_str()),
        Some(n2.id.as_str())
    );
    assert_eq!(reg.state("t"), Some(Lifecycle::Navigating));
    assert_eq!(reg.committed_url("t"), None, "page A was not resurrected");
}

#[test]
fn a_successful_navigation_keeps_its_ticket() {
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    navigate_native(&state, "t", &ticket, replaced, || Ok(())).unwrap();
    let reg = state.registry.lock().unwrap();
    assert_eq!(
        reg.navigation_ticket("t").map(|t| t.id.as_str()),
        Some(ticket.id.as_str())
    );
    assert_eq!(reg.state("t"), Some(Lifecycle::Navigating));
}
