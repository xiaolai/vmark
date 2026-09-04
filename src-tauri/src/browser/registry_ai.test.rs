//! Audit 20260903 round 3, #3 — an AI tab is reserved for ONE request, and a later
//! `browser_ai_create` naming its id is honoured only as that same request.
//!
//! The retry used to be honoured on mode and epoch alone, so a tab reserved by
//! window A for url X could be resumed by window B for url Y, and a tab that had
//! since navigated to Y answered a create for X with Y's ticket.

use super::*;
use crate::browser::registry::{AutomationMode, BrowserRegistry, Lifecycle};

fn request<'a>(window: &'a str, url: &'a str) -> AiTabRequest<'a> {
    AiTabRequest {
        window_label: window,
        mode: AutomationMode::AiSandbox,
        url,
        profile: None,
        policy_epoch: 3,
    }
}

#[test]
fn a_fresh_id_is_reserved_with_the_requests_provenance_and_epoch() {
    let mut reg = BrowserRegistry::default();
    let outcome = reg.reserve_ai_tab("t", &request("main", "https://a.example/"));
    assert_eq!(outcome, Ok(AiReservation::Reserved));
    assert_eq!(reg.state("t"), Some(Lifecycle::Creating));
    assert_eq!(reg.generation("t"), Some(0));
    assert_eq!(reg.window_of("t"), Some("main"));
    assert_eq!(reg.automation_mode("t"), Some(AutomationMode::AiSandbox));
    assert_eq!(
        reg.policy_epoch("t"),
        Some(3),
        "the epoch is stamped at reservation"
    );
    assert_eq!(
        reg.committed_url("t"),
        None,
        "a reservation grants no origin (R7a)"
    );
    assert_eq!(reg.navigation_ticket("t"), None);
}

#[test]
fn the_same_request_resumes_a_reservation_that_never_started_navigating() {
    // The approval-retry flow: a shared `open` stopped at the destination prompt,
    // and the same request arrives again once the user decided.
    let mut reg = BrowserRegistry::default();
    let req = request("main", "https://a.example/");
    reg.reserve_ai_tab("t", &req).unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &req),
        Ok(AiReservation::Resumed { generation: 0 })
    );
    // The generation handed back is the entry's CURRENT one, not a default.
    reg.bump_generation("t").unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &req),
        Ok(AiReservation::Resumed { generation: 1 })
    );
}

#[test]
fn the_same_request_is_idempotent_once_the_navigation_started() {
    let mut reg = BrowserRegistry::default();
    let req = request("main", "https://a.example/");
    reg.reserve_ai_tab("t", &req).unwrap();
    let ticket = reg.begin_navigation("t", "https://a.example/").unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &req),
        Ok(AiReservation::Existing {
            navigation_id: ticket.id
        })
    );
}

#[test]
fn a_retry_from_another_window_is_refused() {
    let mut reg = BrowserRegistry::default();
    reg.reserve_ai_tab("t", &request("a", "https://a.example/"))
        .unwrap();
    // The window is checked before the url: a foreign window learns nothing about
    // what this tab was reserved for.
    assert_eq!(
        reg.reserve_ai_tab("t", &request("b", "https://other.example/")),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Window))
    );
    assert_eq!(
        reg.reserve_ai_tab("t", &request("b", "https://a.example/")),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Window))
    );
    assert_eq!(reg.window_of("t"), Some("a"), "the owner is unchanged");
}

#[test]
fn a_retry_for_another_url_is_refused() {
    let mut reg = BrowserRegistry::default();
    reg.reserve_ai_tab("t", &request("main", "https://a.example/"))
        .unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &request("main", "https://a.example/other")),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Url)),
        "a different path is a different request"
    );
}

#[test]
fn a_retry_with_another_profile_is_refused_in_both_directions() {
    let mut reg = BrowserRegistry::default();
    let with_profile = AiTabRequest {
        profile: Some("work"),
        ..request("main", "https://a.example/")
    };
    reg.reserve_ai_tab("t", &with_profile).unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &request("main", "https://a.example/")),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Profile)),
        "dropping the profile"
    );
    assert_eq!(
        reg.reserve_ai_tab(
            "t",
            &AiTabRequest {
                profile: Some("personal"),
                ..with_profile
            }
        ),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Profile)),
        "swapping the profile"
    );
    assert_eq!(
        reg.reserve_ai_tab("t", &with_profile),
        Ok(AiReservation::Resumed { generation: 0 }),
        "the identical request still resumes"
    );

    let mut reg = BrowserRegistry::default();
    reg.reserve_ai_tab("t", &request("main", "https://a.example/"))
        .unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &with_profile),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Profile)),
        "adding a profile to a profile-less reservation"
    );
}

#[test]
fn a_tab_that_navigated_elsewhere_does_not_answer_a_create_with_its_ticket() {
    // The bug: created for X, navigated to Y, a create for X came back with Y's
    // ticket — "an unrelated ticket" for a reused tab id.
    let mut reg = BrowserRegistry::default();
    let req = request("main", "https://a.example/");
    reg.reserve_ai_tab("t", &req).unwrap();
    reg.begin_navigation("t", "https://a.example/").unwrap();
    reg.begin_navigation("t", "https://elsewhere.example/")
        .unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &req),
        Err(AiReservationRefusal::Mismatch(
            AiRequestMismatch::Navigation
        ))
    );
}

#[test]
fn a_different_mode_is_a_provenance_mismatch_before_anything_else() {
    let mut reg = BrowserRegistry::default();
    reg.reserve_ai_tab(
        "shared",
        &AiTabRequest {
            mode: AutomationMode::AiShared,
            ..request("main", "https://a.example/")
        },
    )
    .unwrap();
    // Everything else differs too; provenance is what is reported.
    assert_eq!(
        reg.reserve_ai_tab("shared", &request("other", "https://b.example/")),
        Err(AiReservationRefusal::ProvenanceMismatch)
    );
    // A HUMAN tab's id is never an AI tab's.
    reg.create("human", "main").unwrap();
    assert_eq!(
        reg.reserve_ai_tab("human", &request("main", "https://a.example/")),
        Err(AiReservationRefusal::ProvenanceMismatch)
    );
}

#[test]
fn a_terminal_entry_refuses_reuse_of_its_id() {
    // `browser_destroy` marks the entry Destroyed before the native teardown and
    // forgets it afterwards; in between, the id is not available.
    let mut reg = BrowserRegistry::default();
    let req = request("main", "https://a.example/");
    reg.reserve_ai_tab("t", &req).unwrap();
    reg.begin_navigation("t", "https://a.example/").unwrap();
    reg.transition("t", Lifecycle::Destroyed).unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &req),
        Err(AiReservationRefusal::Terminal),
        "a dead tab's ticket is not handed back as if it were live"
    );
}

#[test]
fn an_entry_not_reserved_by_an_ai_create_matches_no_request() {
    let mut reg = BrowserRegistry::default();
    reg.create_with_mode("t", "main", AutomationMode::AiSandbox)
        .unwrap();
    assert_eq!(
        reg.reserve_ai_tab("t", &request("main", "https://a.example/")),
        Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Url)),
        "nothing recorded can equal the request"
    );
}

#[test]
fn a_reservation_does_not_count_against_capacity_differently_from_a_created_tab() {
    let mut reg = BrowserRegistry::default();
    reg.reserve_ai_tab("t", &request("main", "https://a.example/"))
        .unwrap();
    assert_eq!(reg.live_ai_tab_count(), 1, "a reserved AI tab holds a slot");
}

#[test]
fn mismatch_kinds_have_stable_wire_names() {
    assert_eq!(AiRequestMismatch::Window.kind(), "window");
    assert_eq!(AiRequestMismatch::Url.kind(), "url");
    assert_eq!(AiRequestMismatch::Profile.kind(), "profile");
    assert_eq!(AiRequestMismatch::Navigation.kind(), "navigation");
}

#[test]
fn a_reservation_under_a_closing_window_is_refused_before_anything_is_recorded() {
    let mut reg = BrowserRegistry::default();
    reg.mark_window_closed("doc-1");
    assert_eq!(
        reg.reserve_ai_tab("t", &request("doc-1", "https://a.example/")),
        Err(AiReservationRefusal::WindowClosed)
    );
    assert!(reg.tab_status("t").is_none());
    assert_eq!(
        reg.reserve_ai_tab("t", &request("main", "https://a.example/")),
        Ok(AiReservation::Reserved)
    );
}
