//! Audit 20260903 round 3 (#2, #3, #4) — the transactions behind
//! `browser_ai_create` / `browser_ai_navigate`, each testable against a plain
//! `BrowserSurface` (no Tauri app). Round 4 (#7 / #8) adds the resolved-address
//! pre-flight both native calls run, with the resolver injected so no test here
//! touches the network.

use super::*;
use crate::browser::ai_guards::blocked_destination;
use crate::browser::ai_policy_dns::{
    DestinationRefused, DestinationResolver, PreflightReason, ResolveFailure,
};
use crate::browser::ai_transactions_preflight::resolved_destination_refused;
use crate::browser::native_failure::NativeSurfaceError;
use crate::browser::profile_open::ProfileOpen;
use crate::browser::registry::{Lifecycle, MAX_AI_TABS};
use crate::command_error::ErrorCode;
use std::cell::Cell;
use std::net::IpAddr;

fn detail(err: &CommandError, key: &str) -> String {
    err.detail()
        .and_then(|d| d.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn mcp_code(err: &CommandError) -> String {
    detail(err, "mcpCode")
}

fn kind(err: &CommandError) -> String {
    detail(err, "kind")
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

/// The pre-flight's one outside input, answered with a fixed set — nothing in
/// this file touches the network.
struct Resolves(Vec<IpAddr>);

impl DestinationResolver for Resolves {
    fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        Ok(self.0.clone())
    }
}

fn answers(addrs: &[&str]) -> Resolves {
    Resolves(addrs.iter().map(|a| a.parse().unwrap()).collect())
}

/// A public answer: the destination is what its name says it is.
fn public() -> Resolves {
    answers(&["93.184.216.34"])
}

/// A resolver the test asserts is never consulted.
struct NeverCalled;

impl DestinationResolver for NeverCalled {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        panic!("the resolver was consulted for {host}");
    }
}

/// A tab reserved and ticketed for `url` — the state `create_native` runs from,
/// in the order the command runs them.
fn reserved_for(state: &BrowserSurface, url: &str) {
    reserve_ai_tab(state, "t", &request("main", url)).unwrap();
    begin_ai_navigation(state, "t", url, AutomationMode::AiSandbox).unwrap();
}

#[test]
fn a_failed_native_creation_forgets_the_tab_and_classifies_the_failure() {
    let state = BrowserSurface::default();
    reserved_for(&state, "https://a.example/");
    state
        .crash_trackers
        .lock()
        .unwrap()
        .entry("t".into())
        .or_default();
    let err = create_native_with(&state, "t", &public(), || {
        Err(NativeSurfaceError::WindowGone("no such window".into()))
    })
    .unwrap_err();
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
    reserved_for(&state, "https://a.example/");
    let mut ran = false;
    create_native_with(&state, "t", &public(), || {
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
    let err = navigate_native_with(&state, "t", &ticket, replaced, &public(), || {
        Err(NativeSurfaceError::NoWebview("no webview: t".into()))
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
    let err = navigate_native_with(&state, "t", &n1, replaced_by_n1, &public(), || {
        Err(NativeSurfaceError::MainThreadTimeout("x".into()))
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
    navigate_native_with(&state, "t", &ticket, replaced, &public(), || Ok(())).unwrap();
    let reg = state.registry.lock().unwrap();
    assert_eq!(
        reg.navigation_ticket("t").map(|t| t.id.as_str()),
        Some(ticket.id.as_str())
    );
    assert_eq!(reg.state("t"), Some(Lifecycle::Navigating));
}

// ------------------------------------------ resolved-address pre-flight (round 4)

fn assert_resolved_refusal(err: &CommandError, host: &str, reason: &str) {
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(
        mcp_code(err),
        "SSRF_BLOCKED",
        "the class the MCP client already matches on"
    );
    assert_eq!(kind(err), "ssrf-blocked");
    assert_eq!(detail(err, "host"), host);
    assert_eq!(detail(err, "reason"), reason);
}

#[test]
fn a_creation_whose_name_resolves_private_is_refused_before_the_native_call_and_forgotten() {
    let state = BrowserSurface::default();
    reserved_for(&state, "https://public.example/");
    let mut ran = false;
    let err = create_native_with(
        &state,
        "t",
        &answers(&["93.184.216.34", "10.0.0.5"]),
        || {
            ran = true;
            Ok(())
        },
    )
    .unwrap_err();
    assert!(
        !ran,
        "the native creation never runs for a refused destination"
    );
    assert_resolved_refusal(&err, "public.example", "resolves-private");
    assert!(
        state.registry.lock().unwrap().tab_status("t").is_none(),
        "forgotten, like any failed creation"
    );
}

#[test]
fn a_creation_whose_name_does_not_resolve_is_refused_closed() {
    let state = BrowserSurface::default();
    reserved_for(&state, "https://public.example/");
    let mut ran = false;
    let err = create_native_with(&state, "t", &answers(&[]), || {
        ran = true;
        Ok(())
    })
    .unwrap_err();
    assert!(!ran);
    assert_resolved_refusal(&err, "public.example", "unresolved");
    assert!(state.registry.lock().unwrap().tab_status("t").is_none());
}

#[test]
fn a_creation_with_no_begun_navigation_is_an_internal_failure_not_a_skipped_check() {
    // `begin_ai_navigation` always precedes `create_native` in the command. A
    // create that reaches the native call without a ticket has nothing to
    // pre-flight, and the answer to that is a loud failure, never a silent skip.
    let state = BrowserSurface::default();
    reserve_ai_tab(&state, "t", &request("main", "https://public.example/")).unwrap();
    let mut ran = false;
    let err = create_native_with(&state, "t", &NeverCalled, || {
        ran = true;
        Ok(())
    })
    .unwrap_err();
    assert!(!ran);
    assert_eq!(err.code(), ErrorCode::Internal);
    assert!(state.registry.lock().unwrap().tab_status("t").is_none());
}

#[test]
fn a_literal_destination_is_created_without_consulting_the_resolver() {
    let state = BrowserSurface::default();
    reserved_for(&state, "http://93.184.216.34/");
    let mut ran = false;
    create_native_with(&state, "t", &NeverCalled, || {
        ran = true;
        Ok(())
    })
    .unwrap();
    assert!(ran);
}

#[test]
fn a_navigation_whose_name_resolves_private_is_refused_and_the_replaced_state_restored() {
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let before = state.registry.lock().unwrap().tab_status("t").unwrap();
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let mut ran = false;
    let err = navigate_native_with(
        &state,
        "t",
        &ticket,
        replaced,
        &answers(&["169.254.169.254"]),
        || {
            ran = true;
            Ok(())
        },
    )
    .unwrap_err();
    assert!(
        !ran,
        "the native navigation never runs for a refused destination"
    );
    assert_resolved_refusal(&err, "b.example", "resolves-private");
    let reg = state.registry.lock().unwrap();
    assert_eq!(reg.tab_status("t").unwrap(), before, "put back exactly");
    assert_eq!(reg.committed_url("t"), Some("https://a.example/"));
}

#[test]
fn a_navigation_whose_name_does_not_resolve_is_refused_closed_and_restored() {
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let before = state.registry.lock().unwrap().tab_status("t").unwrap();
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let err =
        navigate_native_with(&state, "t", &ticket, replaced, &answers(&[]), || Ok(())).unwrap_err();
    assert_resolved_refusal(&err, "b.example", "unresolved");
    let reg = state.registry.lock().unwrap();
    assert_eq!(reg.tab_status("t").unwrap(), before, "put back exactly");
}

#[test]
fn the_pre_flight_judges_against_the_current_loopback_posture() {
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let loopback = answers(&["127.0.0.1"]);
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let err =
        navigate_native_with(&state, "t", &ticket, replaced, &loopback, || Ok(())).unwrap_err();
    assert_resolved_refusal(&err, "b.example", "resolves-private");
    state.ai_policy.lock().unwrap().allow_loopback = true;
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    navigate_native_with(&state, "t", &ticket, replaced, &loopback, || Ok(())).unwrap();
    // "My own machine" never widens to the LAN.
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    let err = navigate_native_with(
        &state,
        "t",
        &ticket,
        replaced,
        &answers(&["192.168.1.20"]),
        || Ok(()),
    )
    .unwrap_err();
    assert_resolved_refusal(&err, "b.example", "resolves-private");
}

#[test]
fn a_resolved_refusal_is_the_same_class_as_a_blocked_literal() {
    let literal = blocked_destination();
    let resolved = resolved_destination_refused(&DestinationRefused {
        host: "public.example".into(),
        reason: PreflightReason::ResolvesPrivate,
    });
    assert_eq!(resolved.code(), literal.code());
    assert_eq!(resolved.i18n_key(), literal.i18n_key());
    assert_eq!(resolved.message(), literal.message());
    assert_eq!(mcp_code(&resolved), mcp_code(&literal));
    assert_eq!(kind(&resolved), kind(&literal));
    assert_eq!(detail(&resolved, "host"), "public.example");
    assert_eq!(detail(&resolved, "reason"), "resolves-private");
}

#[test]
fn the_resolver_is_consulted_with_no_surface_lock_held() {
    // DNS may take seconds, and the navigation delegate on the main thread takes
    // both of these locks: resolving under either would stall the UI.
    struct LockProbe<'a> {
        state: &'a BrowserSurface,
        both_free: Cell<Option<bool>>,
    }
    impl DestinationResolver for LockProbe<'_> {
        fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
            let registry = self.state.registry.try_lock().is_ok();
            let policy = self.state.ai_policy.try_lock().is_ok();
            self.both_free.set(Some(registry && policy));
            Ok(vec!["93.184.216.34".parse().unwrap()])
        }
    }
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let probe = LockProbe {
        state: &state,
        both_free: Cell::new(None),
    };
    let (ticket, replaced) =
        begin_ai_navigation(&state, "t", "https://b.example/", AutomationMode::AiSandbox).unwrap();
    navigate_native_with(&state, "t", &ticket, replaced, &probe, || Ok(())).unwrap();
    assert_eq!(
        probe.both_free.get(),
        Some(true),
        "navigate resolved under a lock"
    );
    probe.both_free.set(None);
    reserve_ai_tab(&state, "c", &request("main", "https://c.example/")).unwrap();
    begin_ai_navigation(&state, "c", "https://c.example/", AutomationMode::AiSandbox).unwrap();
    create_native_with(&state, "c", &probe, || Ok(())).unwrap();
    assert_eq!(
        probe.both_free.get(),
        Some(true),
        "create resolved under a lock"
    );
}

#[test]
fn the_production_wrappers_resolve_with_the_system_resolver() {
    // `localhost` comes from the hosts file on every platform, so the real
    // resolver runs offline: refused under the default posture, allowed once the
    // user has opted loopback in.
    let state = BrowserSurface::default();
    live_tab(&state, "https://a.example/");
    let (ticket, replaced) = begin_ai_navigation(
        &state,
        "t",
        "http://localhost:3000/",
        AutomationMode::AiSandbox,
    )
    .unwrap();
    let mut ran = false;
    let err = navigate_native(&state, "t", &ticket, replaced, || {
        ran = true;
        Ok(())
    })
    .unwrap_err();
    assert!(!ran);
    assert_resolved_refusal(&err, "localhost", "resolves-private");
    state.ai_policy.lock().unwrap().allow_loopback = true;
    let (ticket, replaced) = begin_ai_navigation(
        &state,
        "t",
        "http://localhost:3000/",
        AutomationMode::AiSandbox,
    )
    .unwrap();
    navigate_native(&state, "t", &ticket, replaced, || Ok(())).unwrap();

    let state = BrowserSurface::default();
    reserved_for(&state, "http://localhost:3000/");
    let err = create_native(&state, "t", || Ok(())).unwrap_err();
    assert_resolved_refusal(&err, "localhost", "resolves-private");
    assert!(state.registry.lock().unwrap().tab_status("t").is_none());
    state.ai_policy.lock().unwrap().allow_loopback = true;
    reserved_for(&state, "http://localhost:3000/");
    create_native(&state, "t", || Ok(())).unwrap();
}
