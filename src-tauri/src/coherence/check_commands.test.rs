// WI-2b.4 — check service: prepare loads CAS texts + fed claims,
// record appends a D5.6-complete result, and the breakdown flips to the
// axis-2 state (design-2a.md D5; spec §5.4.4 revision 1).

use super::*;
use crate::coherence::capture::{capture, CaptureInputSpec, CaptureRequest};
use crate::coherence::checker::parse_check_response;
use crate::coherence::claim_commands::{perform_claim, ClaimRequest};
use crate::coherence::commands::perform_breakdown;
use crate::coherence::project::EdgeState;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, InputRole, Intent, WriterId};
use uuid::Uuid;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let td = tempfile::tempdir().expect("tempdir");
    let kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).expect("kernel");
    (td, kernel)
}

fn cap(kernel: &mut WorkspaceKernel, rel: &str, content: &str, inputs: Vec<CaptureInputSpec>) {
    std::fs::write(kernel.root().join(rel), content).unwrap();
    capture(
        kernel,
        CaptureRequest {
            path: rel.into(),
            content: content.into(),
            inputs,
            agent: Agent {
                kind: AgentType::Model,
                id: Some("test".into()),
            },
            intent: Intent {
                kind: "test".into(),
                summary: "t".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .expect("capture");
}

fn direct(path: &str) -> CaptureInputSpec {
    CaptureInputSpec {
        path: Some(path.into()),
        object_id: None,
        revision: None,
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }
}

/// elena.md v1 → scene (pinned v1) → elena.md v2: one version-stale edge.
fn stale_fixture(kernel: &mut WorkspaceKernel) -> (Uuid, u32) {
    cap(kernel, "elena.md", "Her eyes were green.\n", vec![]);
    cap(
        kernel,
        "scene.md",
        "Elena's green eyes watched the tide.\n",
        vec![direct("elena.md")],
    );
    cap(kernel, "elena.md", "Her eyes were brown.\n", vec![]);
    let rows = perform_breakdown(kernel).expect("breakdown");
    assert_eq!(rows.len(), 1, "one stale edge expected");
    (rows[0].txf, rows[0].input)
}

#[test]
fn prepare_loads_texts_and_claims_into_prompt() {
    let (_td, mut kernel) = workspace();
    let (txf, input) = stale_fixture(&mut kernel);
    // An established, scoped claim joins the feed (D4).
    let receipt = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("Elena is left-handed".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "tester",
    )
    .unwrap();
    perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "promote".into(),
            claim: Some(receipt.claim),
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "tester",
    )
    .unwrap();

    let prepared = prepare_check(&mut kernel, &txf, input).expect("prepare");
    for needle in [
        "Her eyes were green.",
        "Her eyes were brown.",
        "Elena's green eyes",
        "Elena is left-handed",
        "elena.md",
        "scene.md",
    ] {
        assert!(prepared.prompt.contains(needle), "missing {needle:?}");
    }
    assert_ne!(
        prepared.claims_fingerprint,
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "fed claim must change the fingerprint"
    );
    assert_ne!(prepared.pinned, prepared.checked_against);
}

#[test]
fn record_flips_breakdown_to_axis2_state() {
    let (_td, mut kernel) = workspace();
    let (txf, input) = stale_fixture(&mut kernel);
    let prepared = prepare_check(&mut kernel, &txf, input).unwrap();
    let parsed = parse_check_response(
        r#"{"verdict":"contradiction","confidence":0.97,
            "evidence":[{"quote":"Elena's green eyes","loc":"L1"}]}"#,
        DEFAULT_TAU,
    );
    let receipt = record_check(&mut kernel, &prepared, &parsed, "test-model").unwrap();
    assert_eq!(receipt.verdict, "contradiction");
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows[0].state, EdgeState::StaleContradicted);
}

#[test]
fn provider_failure_records_unknown_not_error() {
    let (_td, mut kernel) = workspace();
    let (txf, input) = stale_fixture(&mut kernel);
    let prepared = prepare_check(&mut kernel, &txf, input).unwrap();
    // The command layer maps timeout/provider errors to this parse.
    let parsed = parse_check_response("provider exploded, no json here", DEFAULT_TAU);
    let receipt = record_check(&mut kernel, &prepared, &parsed, "test-model").unwrap();
    assert_eq!(receipt.verdict, "unknown");
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows[0].state, EdgeState::StaleUnknown);
}

#[test]
fn claim_change_after_check_expires_it() {
    let (_td, mut kernel) = workspace();
    let (txf, input) = stale_fixture(&mut kernel);
    let prepared = prepare_check(&mut kernel, &txf, input).unwrap();
    let parsed = parse_check_response(
        r#"{"verdict":"no-contradiction","confidence":0.95,"evidence":[]}"#,
        DEFAULT_TAU,
    );
    record_check(&mut kernel, &prepared, &parsed, "test-model").unwrap();
    assert_eq!(
        perform_breakdown(&mut kernel).unwrap()[0].state,
        EdgeState::StaleValid
    );
    // A new established claim changes the snapshot → the result is no
    // longer live (D5.6); the row falls back to plain version-stale.
    let receipt = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("The tide is out".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "tester",
    )
    .unwrap();
    perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "promote".into(),
            claim: Some(receipt.claim),
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "tester",
    )
    .unwrap();
    assert_eq!(
        perform_breakdown(&mut kernel).unwrap()[0].state,
        EdgeState::VersionStale
    );
}

#[test]
fn prepare_on_unknown_edge_fails_loud() {
    let (_td, mut kernel) = workspace();
    let err = prepare_check(&mut kernel, &Uuid::now_v7(), 0).unwrap_err();
    assert!(err.contains("no such edge"), "{err}");
}

#[test]
fn check_recorded_in_default_is_not_live_in_a_named_context() {
    let (_td, mut kernel) = workspace();
    let (txf, input) = stale_fixture(&mut kernel);
    let prepared = prepare_check(&mut kernel, &txf, input).unwrap();
    let parsed = parse_check_response(
        r#"{"verdict":"no-contradiction","confidence":0.95,"evidence":[]}"#,
        DEFAULT_TAU,
    );
    record_check(&mut kernel, &prepared, &parsed, "test-model").unwrap();
    // Default context: the check is live.
    assert_eq!(
        crate::coherence::commands::perform_breakdown_in(&mut kernel, None).unwrap()[0].state,
        EdgeState::StaleValid
    );
    // A named context: same claims (none), but a different context id —
    // the result is not live there (D5.6 context binding).
    let ctx =
        crate::coherence::context_commands::perform_context_create(&mut kernel, "night-arc", None)
            .unwrap();
    assert_eq!(
        crate::coherence::commands::perform_breakdown_in(&mut kernel, Some(ctx.id)).unwrap()[0]
            .state,
        EdgeState::VersionStale
    );
}
