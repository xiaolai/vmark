//! WI-19 — the workflow engine's backend gate.
//!
//! Before this, the flag lived only in the webview: `run_workflow` was
//! registered unconditionally and ran whatever YAML it was handed, so anything
//! that could reach the IPC boundary — the MCP bridge, a second window, a
//! replayed invoke — executed steps for a feature the user had switched off.
//! Hiding a button is not enforcement.

use super::*;
use crate::command_error::ErrorCode;
use crate::workflow::state::WorkflowRunnerState;

#[test]
fn the_gate_is_closed_before_the_frontend_ever_pushes_a_flag() {
    // Fail-closed: a state that has never been told anything refuses. The
    // opposite default would run workflows during the window between app start
    // and the first policy push.
    let state = WorkflowRunnerState::default();
    let err = require_workflow_engine_enabled(&state).expect_err("default is off");
    assert_eq!(err.code(), ErrorCode::FeatureDisabled);
    assert_eq!(err.i18n_key(), Some("errors.workflow.engineDisabled"));
}

#[test]
fn the_refusal_serializes_to_the_exact_feature_disabled_wire_shape() {
    // Through real serde, not a hand-written expectation of it: this is the
    // object `parseCommandError` on the frontend receives.
    let state = WorkflowRunnerState::default();
    let err = require_workflow_engine_enabled(&state).expect_err("default is off");
    let wire = serde_json::to_value(&err).expect("CommandError serializes");
    let object = wire.as_object().expect("an object, not a string");

    assert_eq!(
        object.get("code").and_then(|v| v.as_str()),
        Some("feature-disabled")
    );
    assert_eq!(
        object.get("i18nKey").and_then(|v| v.as_str()),
        Some("errors.workflow.engineDisabled")
    );
    assert!(
        object
            .get("message")
            .and_then(|v| v.as_str())
            .is_some_and(|m| !m.is_empty()),
        "the user-visible message must be rendered, not empty"
    );
    // Absent optionals are ABSENT, not null — a `"detail" in err` guard on the
    // frontend has to mean what it reads like.
    assert!(!object.contains_key("detail"), "no detail key: {wire}");
    assert_eq!(
        object.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["code", "message", "i18nKey"],
        "exactly the WI-14 wire shape, nothing more"
    );
}

#[test]
fn the_gate_opens_once_the_engine_flag_is_pushed_on() {
    let state = WorkflowRunnerState::default();
    state.set_engine_enabled(true);
    assert!(
        require_workflow_engine_enabled(&state).is_ok(),
        "flag on must behave exactly as before the gate existed"
    );
}

#[test]
fn the_gate_closes_again_when_the_user_switches_the_engine_off() {
    // The settings subscription pushes both directions; a one-way latch would
    // leave the runner armed for the rest of the session.
    let state = WorkflowRunnerState::default();
    state.set_engine_enabled(true);
    state.set_engine_enabled(false);
    assert_eq!(
        require_workflow_engine_enabled(&state)
            .expect_err("off again")
            .code(),
        ErrorCode::FeatureDisabled
    );
}

#[test]
fn repeated_pushes_of_the_same_value_are_idempotent() {
    let state = WorkflowRunnerState::default();
    for _ in 0..3 {
        state.set_engine_enabled(true);
    }
    assert!(require_workflow_engine_enabled(&state).is_ok());
    for _ in 0..3 {
        state.set_engine_enabled(false);
    }
    assert!(require_workflow_engine_enabled(&state).is_err());
}

/// Every workflow command that STARTS work must consult the gate.
///
/// A guard that exists and is not called is the failure mode this WI was
/// written about: `.claude/hooks/gha-tdd-guard.mjs` listed four paths that had
/// not existed for months and nothing noticed. So the invariant is asserted
/// against the real source rather than trusted to review — add a command to
/// this module and the test fails until it is either gated or named here as
/// deliberately ungated, with a reason.
#[test]
fn every_registered_workflow_command_consults_the_gate() {
    // The three deliberate exemptions, each for the same underlying reason:
    // the gate's job is "do not START things", so a command that only stops or
    // configures must not be behind it. Audit 20260803 §3 found the opposite —
    // gating cancel/respond made a running workflow unstoppable by the very
    // user who had just switched the feature off.
    const UNGATED: &[&str] = &[
        // IS the gate's setter — gating it would make the flag unsettable.
        "workflow_engine_policy",
        // Stops a run. Must stay reachable after the engine is switched off.
        "cancel_workflow",
        // Answers a step already blocked on the user. Refusing it would strand
        // the runner on its receiver until the step's own timeout.
        "respond_workflow_approval",
    ];

    let source = include_str!("commands.rs");
    let mut seen = 0usize;
    let mut checked = 0usize;
    for (index, _) in source.match_indices("#[tauri::command]") {
        let rest = &source[index..];
        let name = rest
            .split("pub async fn ")
            .nth(1)
            .and_then(|after| after.split('(').next())
            .expect("a command attribute is followed by its fn")
            .trim()
            .to_string();
        seen += 1;
        if UNGATED.contains(&name.as_str()) {
            continue;
        }
        // The body runs to the next command attribute (or end of file).
        let body_end = rest[1..]
            .find("#[tauri::command]")
            .map(|offset| offset + 1)
            .unwrap_or(rest.len());
        let body = &rest[..body_end];
        assert!(
            body.contains("require_workflow_engine_enabled"),
            "workflow command `{name}` does not check the engine flag — \
             backend enforcement is the point of WI-19"
        );
        checked += 1;
    }
    assert!(
        seen >= 4,
        "expected run/cancel/respond/policy to be scanned, saw {seen} — \
         the scanner stopped seeing command sites"
    );
    assert!(
        checked >= 1,
        "no gated command was verified — every command ended up exempt, which \
         would make the gate decorative"
    );
}

/// The exemptions are a claim about *reachability*, so pin the one that
/// matters: cancelling is possible with the engine flag off.
///
/// Asserted on the state rather than through `cancel_workflow`, which needs a
/// Tauri `State` — `workflow/state.test.rs` owns the same invariant from the
/// other side (`request_cancel_works_while_the_engine_flag_is_off`).
#[test]
fn the_gate_does_not_reach_the_cancel_path() {
    let source = include_str!("commands.rs");
    let cancel = source
        .split("pub async fn cancel_workflow")
        .nth(1)
        .expect("cancel_workflow exists");
    let body = cancel
        .split("#[tauri::command]")
        .next()
        .expect("a command body");
    assert!(
        !body.contains("require_workflow_engine_enabled"),
        "cancel_workflow is gated again — a running workflow becomes \
         unstoppable the moment the user switches the engine off"
    );
}
