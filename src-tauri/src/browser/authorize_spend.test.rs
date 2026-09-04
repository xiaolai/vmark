//! Audit 20260903 round 3, #10 — the spending half of the driver gate. `spend`
//! consumes exactly what the `Decision` requires, in the attachments → one_shots
//! order, and a denial burns nothing.

use super::*;
use crate::browser::one_shot::OneShot;
use crate::command_error::ErrorCode;

fn mcp_code(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("mcpCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// A surface whose registry knows `t` at generation 0 (attachments bind to it).
fn surface() -> BrowserSurface {
    let s = BrowserSurface::default();
    s.registry.lock().unwrap().create("t", "main").unwrap();
    s
}

fn decision(mode: AutomationMode, allowed: bool) -> Decision {
    Decision {
        mode,
        committed: "https://ex.com/page".into(),
        allowed,
    }
}

fn one_shot(operation: &str, origin_pattern: &str, target: Option<OneShotTarget>) -> OneShot {
    OneShot {
        tab_id: "t".into(),
        generation: 0,
        origin_pattern: origin_pattern.into(),
        operation: operation.into(),
        target,
        payload_hash: None,
    }
}

fn one_shots_left(s: &BrowserSurface) -> usize {
    s.one_shots.lock().unwrap().len()
}

#[test]
fn an_allowed_decision_on_an_ai_tab_spends_nothing() {
    let s = surface();
    s.one_shots
        .lock()
        .unwrap()
        .push(one_shot("click", "https://ex.com", None));
    spend(
        &s,
        &decision(AutomationMode::AiSandbox, true),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        one_shots_left(&s),
        1,
        "standing authority spends no one-shot"
    );
}

#[test]
fn a_disallowed_decision_consumes_exactly_one_matching_one_shot() {
    let s = surface();
    {
        let mut shots = s.one_shots.lock().unwrap();
        shots.push(one_shot("click", "https://ex.com", None));
        shots.push(one_shot("click", "https://ex.com", None));
    }
    spend(
        &s,
        &decision(AutomationMode::AiSandbox, false),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap();
    assert_eq!(one_shots_left(&s), 1);
}

#[test]
fn a_disallowed_decision_with_no_matching_one_shot_is_not_granted_and_burns_nothing() {
    let s = surface();
    s.one_shots.lock().unwrap().push(one_shot(
        "click",
        "https://ex.com",
        Some(OneShotTarget {
            role: "button".into(),
            name: "Publish".into(),
        }),
    ));
    let wrong = OneShotTarget {
        role: "button".into(),
        name: "Delete".into(),
    };
    let err = spend(
        &s,
        &decision(AutomationMode::AiSandbox, false),
        "t",
        0,
        "click",
        Some(&wrong),
        None,
    )
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "NOT_GRANTED");
    assert_eq!(one_shots_left(&s), 1, "a mismatch must not spend it");
}

#[test]
fn the_one_shot_is_matched_against_the_decisions_committed_origin() {
    // The decision's `committed` came from the registry; a one-shot for another
    // origin cannot authorize an action on this page.
    let s = surface();
    s.one_shots
        .lock()
        .unwrap()
        .push(one_shot("click", "https://other.com", None));
    let err = spend(
        &s,
        &decision(AutomationMode::AiSandbox, false),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(mcp_code(&err), "NOT_GRANTED");
    assert_eq!(one_shots_left(&s), 1);
}

#[test]
fn a_human_decision_re_verifies_the_attachment_under_its_own_lock() {
    // The decision was made against a PEEK; the attachment may have been cleared
    // since (a navigation, a destroy). Refuse, and leave the one-shot alone.
    let s = surface();
    s.one_shots
        .lock()
        .unwrap()
        .push(one_shot("click", "https://ex.com", None));
    let err = spend(
        &s,
        &decision(AutomationMode::Human, false),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
    assert_eq!(one_shots_left(&s), 1, "no consent burned on a denial");
}

#[test]
fn a_human_single_use_attachment_is_consumed_last_and_a_persistent_one_kept() {
    let s = surface();
    s.attach_tab("t".into(), 0, true).unwrap();
    spend(
        &s,
        &decision(AutomationMode::Human, true),
        "t",
        0,
        "read",
        None,
        None,
    )
    .unwrap();
    assert!(!s.is_tab_attached("t", 0), "one use, spent");

    s.attach_tab("t".into(), 0, false).unwrap();
    spend(
        &s,
        &decision(AutomationMode::Human, true),
        "t",
        0,
        "read",
        None,
        None,
    )
    .unwrap();
    spend(
        &s,
        &decision(AutomationMode::Human, true),
        "t",
        0,
        "read",
        None,
        None,
    )
    .unwrap();
    assert!(s.is_tab_attached("t", 0), "a persistent attachment stays");
}

#[test]
fn a_human_denial_after_the_attachment_check_burns_neither_resource() {
    let s = surface();
    s.attach_tab("t".into(), 0, true).unwrap();
    let err = spend(
        &s,
        &decision(AutomationMode::Human, false),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(mcp_code(&err), "NOT_GRANTED");
    assert!(
        s.is_tab_attached("t", 0),
        "the attachment is consumed only after the one-shot succeeded"
    );
}

#[test]
fn a_human_one_shot_path_consumes_both_resources() {
    let s = surface();
    s.attach_tab("t".into(), 0, true).unwrap();
    s.one_shots
        .lock()
        .unwrap()
        .push(one_shot("click", "https://ex.com", None));
    spend(
        &s,
        &decision(AutomationMode::Human, false),
        "t",
        0,
        "click",
        None,
        None,
    )
    .unwrap();
    assert_eq!(one_shots_left(&s), 0);
    assert!(!s.is_tab_attached("t", 0));
}

#[test]
fn spend_releases_every_lock_it_took() {
    let s = surface();
    s.attach_tab("t".into(), 0, false).unwrap();
    spend(
        &s,
        &decision(AutomationMode::Human, true),
        "t",
        0,
        "read",
        None,
        None,
    )
    .unwrap();
    assert!(s.attachments.try_lock().is_ok());
    assert!(s.one_shots.try_lock().is_ok());
}
