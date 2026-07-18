// WI-3.1 — human-edit provenance: context-relative head-safe proposals
// (prior-input-set heuristic) and provenance-confirmation re-emission
// (design-3.md D1; spec §5.4.1a revision 2).

use super::*;
use crate::coherence::capture::{capture, CaptureInputSpec, CaptureRequest};
use crate::coherence::commands::perform_breakdown;
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
                kind: AgentType::Human,
                id: Some("tester".into()),
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
    }
}

fn contextual(path: &str) -> CaptureInputSpec {
    CaptureInputSpec {
        path: Some(path.into()),
        object_id: None,
        revision: None,
        role: InputRole::Contextual,
    }
}

/// elena + style → scene (derived), then scene edited by a human with
/// no inputs: the head loses its live edges — the D1 scenario.
fn orphaned_scene(kernel: &mut WorkspaceKernel) {
    cap(kernel, "elena.md", "Her eyes were green.\n", vec![]);
    cap(kernel, "style.md", "Write tersely.\n", vec![]);
    cap(
        kernel,
        "scene.md",
        "Elena's green eyes.\n",
        vec![direct("elena.md"), contextual("style.md")],
    );
    cap(kernel, "scene.md", "Elena's green eyes watched.\n", vec![]);
}

#[test]
fn proposal_recovers_prior_inputs_with_roles() {
    let (_td, mut kernel) = workspace();
    orphaned_scene(&mut kernel);
    let p = perform_propose_inputs(&mut kernel, "scene.md").expect("proposal");
    assert_eq!(p.inputs.len(), 2);
    let elena = p.inputs.iter().find(|i| i.path == "elena.md").unwrap();
    let style = p.inputs.iter().find(|i| i.path == "style.md").unwrap();
    assert_eq!(elena.role, "direct");
    assert_eq!(
        style.role, "contextual",
        "roles never silently promote (R24)"
    );
}

#[test]
fn no_proposal_when_head_already_has_live_edges() {
    let (_td, mut kernel) = workspace();
    cap(&mut kernel, "elena.md", "x\n", vec![]);
    cap(&mut kernel, "scene.md", "y\n", vec![direct("elena.md")]);
    let err = perform_propose_inputs(&mut kernel, "scene.md").unwrap_err();
    assert!(err.contains("already"), "{err}");
}

#[test]
fn no_proposal_without_ancestral_inputs() {
    let (_td, mut kernel) = workspace();
    cap(&mut kernel, "notes.md", "just notes\n", vec![]);
    let err = perform_propose_inputs(&mut kernel, "notes.md").unwrap_err();
    assert!(err.contains("no prior input set"), "{err}");
}

#[test]
fn confirmation_reattaches_edges_without_minting() {
    let (_td, mut kernel) = workspace();
    orphaned_scene(&mut kernel);
    let p = perform_propose_inputs(&mut kernel, "scene.md").unwrap();
    let before = kernel.index().load_dag().unwrap().revision_count(&p.object);
    perform_confirm_inputs(
        &mut kernel,
        &ConfirmRequest {
            path: "scene.md".into(),
            head: p.head.clone(),
            inputs: p
                .inputs
                .iter()
                .map(|i| ConfirmInput {
                    path: i.path.clone(),
                    role: i.role.clone(),
                })
                .collect(),
            idem: None,
        },
        "tester",
    )
    .expect("confirm");
    let after = kernel.index().load_dag().unwrap().revision_count(&p.object);
    assert_eq!(before, after, "re-emission mints no revision");
    // The edge is real: advancing elena now flags the scene.
    cap(&mut kernel, "elena.md", "Her eyes were brown.\n", vec![]);
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].downstream_path.as_deref(), Some("scene.md"));
}

#[test]
fn confirmation_retry_with_same_idem_is_deduplicated() {
    let (_td, mut kernel) = workspace();
    orphaned_scene(&mut kernel);
    let p = perform_propose_inputs(&mut kernel, "scene.md").unwrap();
    let idem = Uuid::now_v7();
    let req = ConfirmRequest {
        path: "scene.md".into(),
        head: p.head.clone(),
        inputs: vec![ConfirmInput {
            path: "elena.md".into(),
            role: "direct".into(),
        }],
        idem: Some(idem),
    };
    perform_confirm_inputs(&mut kernel, &req, "tester").unwrap();
    perform_confirm_inputs(&mut kernel, &req, "tester").unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    let confirmations = entries
        .iter()
        .filter(|e| e.body["intent"]["kind"] == "provenance-confirmation")
        .count();
    assert_eq!(confirmations, 1, "same idem, one applied confirmation");
}

#[test]
fn stale_confirmation_fails_loud() {
    let (_td, mut kernel) = workspace();
    orphaned_scene(&mut kernel);
    let p = perform_propose_inputs(&mut kernel, "scene.md").unwrap();
    // The head moves after the proposal was shown.
    cap(&mut kernel, "scene.md", "Rewritten again.\n", vec![]);
    let err = perform_confirm_inputs(
        &mut kernel,
        &ConfirmRequest {
            path: "scene.md".into(),
            head: p.head,
            inputs: vec![ConfirmInput {
                path: "elena.md".into(),
                role: "direct".into(),
            }],
            idem: None,
        },
        "tester",
    )
    .unwrap_err();
    assert!(err.contains("stale confirmation"), "{err}");
}

#[test]
fn confirmation_carries_no_prior_resolutions() {
    let (_td, mut kernel) = workspace();
    orphaned_scene(&mut kernel);
    let p = perform_propose_inputs(&mut kernel, "scene.md").unwrap();
    perform_confirm_inputs(
        &mut kernel,
        &ConfirmRequest {
            path: "scene.md".into(),
            head: p.head,
            inputs: vec![ConfirmInput {
                path: "elena.md".into(),
                role: "direct".into(),
            }],
            idem: None,
        },
        "tester",
    )
    .unwrap();
    cap(&mut kernel, "elena.md", "brown\n", vec![]);
    let rows = perform_breakdown(&mut kernel).unwrap();
    // Fresh edges start unresolved — plain version-stale, nothing waived.
    assert_eq!(rows.len(), 1);
}
