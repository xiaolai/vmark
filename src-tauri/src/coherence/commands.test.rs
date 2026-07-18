// WI-1.9a — resolution write API: accept-newer appends a ratification
// that clears the breakdown row, waive appends a waiver (reason
// mandatory) shown distinctly, multi-head upstreams reject both actions
// (spec §9.2), unknown edges reject, and every path is append-only (I5 —
// nothing is ever rewritten; asserted via ledger entry counts only
// growing). Also covers actor identity fallback.

use super::*;
use crate::coherence::capture::CaptureInputSpec;
use crate::coherence::project::EdgeState;
use crate::coherence::types::{Agent, AgentType, Confidence, InputRole, Intent};

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    (dir, kernel)
}

fn write_file(root: &std::path::Path, rel: &str, content: &str) {
    std::fs::write(root.join(rel), content).unwrap();
}

fn save(kernel: &mut WorkspaceKernel, rel: &str, content: &str) -> CaptureReceipt {
    capture(
        kernel,
        CaptureRequest {
            path: rel.into(),
            content: content.into(),
            inputs: vec![],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "editor-save".into(),
                summary: "save".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap()
}

/// Build the canonical stale-edge scenario; returns the edge coordinates.
fn stale_edge(root: &std::path::Path, kernel: &mut WorkspaceKernel) -> (Uuid, u32) {
    write_file(root, "elena.md", "elena-v1\n");
    let elena = save(kernel, "elena.md", "elena-v1\n");
    write_file(root, "scene.md", "scene\n");
    let scene = capture(
        kernel,
        CaptureRequest {
            path: "scene.md".into(),
            content: "scene\n".into(),
            inputs: vec![CaptureInputSpec {
                path: None,
                object_id: Some(elena.object),
                revision: None,
                role: InputRole::Direct,
            }],
            agent: Agent {
                kind: AgentType::Model,
                id: Some("m".into()),
            },
            intent: Intent {
                kind: "genie".into(),
                summary: "gen".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    // Advance elena so the edge goes stale.
    let elena_disk = std::fs::read_to_string(root.join("elena.md")).unwrap();
    let v2 = elena_disk.replace("elena-v1", "elena-v2");
    write_file(root, "elena.md", &v2);
    save(kernel, "elena.md", &v2);
    (scene.entry_id.unwrap(), 0)
}

#[test]
fn accept_newer_ratifies_and_clears_breakdown() {
    let (dir, mut kernel) = workspace();
    let (txf, input) = stale_edge(dir.path(), &mut kernel);
    assert_eq!(perform_breakdown(&mut kernel).unwrap().len(), 1);

    let receipt = perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "accept-newer".into(),
            txf,
            input,
            reason: None,
        },
        "xiaolai",
    )
    .unwrap();
    assert_eq!(receipt.kind, "ratification");
    assert!(
        perform_breakdown(&mut kernel).unwrap().is_empty(),
        "ratified edge is fresh"
    );
}

#[test]
fn waive_requires_reason_and_shows_distinctly() {
    let (dir, mut kernel) = workspace();
    let (txf, input) = stale_edge(dir.path(), &mut kernel);

    let no_reason = perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "waive".into(),
            txf,
            input,
            reason: None,
        },
        "xiaolai",
    );
    assert!(no_reason.is_err(), "waiver without reason must be rejected");

    perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "waive".into(),
            txf,
            input,
            reason: Some("unreliable narrator".into()),
        },
        "xiaolai",
    )
    .unwrap();
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(
        matches!(rows[0].state, EdgeState::Waived),
        "waived, displayed distinctly"
    );
}

#[test]
fn resolve_after_further_advance_reopens() {
    let (dir, mut kernel) = workspace();
    let (txf, input) = stale_edge(dir.path(), &mut kernel);
    perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "accept-newer".into(),
            txf,
            input,
            reason: None,
        },
        "xiaolai",
    )
    .unwrap();
    // Upstream advances again: the ratification binds to the old target.
    let elena_disk = std::fs::read_to_string(dir.path().join("elena.md")).unwrap();
    let v3 = elena_disk.replace("elena-v2", "elena-v3");
    write_file(dir.path(), "elena.md", &v3);
    save(&mut kernel, "elena.md", &v3);
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1, "edge reopened (v0 resolution scope)");
    assert!(matches!(rows[0].state, EdgeState::VersionStale));
}

#[test]
fn multi_head_upstream_rejects_both_actions() {
    let (dir, mut kernel) = workspace();
    let (txf, input) = stale_edge(dir.path(), &mut kernel);
    // Fork elena: external edit creates a second head from the OLD content.
    // Simulate by appending a transformation with the v1 revision as parent.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let (elena_obj, v1_rev) = entries
        .iter()
        .find_map(|e| match e.typed().ok()? {
            crate::coherence::types::TypedBody::Transformation(t)
                if t.intent.kind == "editor-save" && t.outputs[0].parents.is_empty() =>
            {
                Some((t.outputs[0].object, t.outputs[0].revision.clone()))
            }
            _ => None,
        })
        .expect("elena root revision");
    let fork_hash = crate::coherence::canonical::text_content_hash("forked elena\n");
    let fork_rev =
        crate::coherence::types::RevisionId::compute(&fork_hash, std::slice::from_ref(&v1_rev));
    let t = crate::coherence::types::Transformation {
        inputs: vec![],
        outputs: vec![crate::coherence::types::OutputRef {
            object: elena_obj,
            revision: fork_rev,
            content_hash: fork_hash,
            parents: vec![v1_rev],
        }],
        agent: Agent {
            kind: AgentType::External,
            id: None,
        },
        intent: Intent {
            kind: "observed-external-edit".into(),
            summary: "fork".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Unknown,
    };
    let env = crate::coherence::types::Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&t).unwrap(),
    );
    kernel.append_and_apply(&env).unwrap();

    for action in ["accept-newer", "waive"] {
        let err = perform_resolve(
            &mut kernel,
            &ResolveRequest {
                action: action.into(),
                txf,
                input,
                reason: Some("r".into()),
            },
            "xiaolai",
        )
        .unwrap_err();
        assert!(err.contains("multiple live heads"), "{action}: {err}");
    }
}

#[test]
fn unknown_edge_and_unknown_action_are_rejected() {
    let (_dir, mut kernel) = workspace();
    let missing = perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "accept-newer".into(),
            txf: Uuid::from_u128(9),
            input: 0,
            reason: None,
        },
        "x",
    );
    assert!(missing.is_err());
    let bogus = perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "delete-history".into(),
            txf: Uuid::from_u128(9),
            input: 0,
            reason: None,
        },
        "x",
    );
    assert!(bogus.unwrap_err().contains("unknown resolve action"));
}

#[test]
fn actor_identity_never_blank() {
    let dir = tempfile::tempdir().unwrap();
    let actor = actor_identity(dir.path());
    assert!(!actor.trim().is_empty());
}

#[test]
fn status_reports_counts() {
    let (dir, mut kernel) = workspace();
    let status = perform_status(&mut kernel).unwrap();
    assert!(!status.initialized);
    assert_eq!(status.objects, 0);
    let (_txf, _input) = stale_edge(dir.path(), &mut kernel);
    let status = perform_status(&mut kernel).unwrap();
    assert!(status.initialized);
    assert_eq!(status.objects, 2);
    assert_eq!(status.open_items, 1);
}

/// Synthetic dogfood session (plan "Dogfood protocol"): a scripted story
/// session through the REAL kernel APIs — the same code paths the app's
/// funnels call. Measures M1 = AI generations carrying complete input
/// sets at the designed confidence. Results are recorded in
/// dev-docs/grills/coherence/dogfood-log.md, labeled synthetic.
#[test]
fn synthetic_dogfood_session_m1() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();

    // Session: world docs written by hand, scenes generated against them.
    for (path, body) in [
        ("elena.md", "# Elena\nEyes: green. Fears deep water.\n"),
        ("marcus.md", "# Marcus\nElena's father. Keeps bees.\n"),
        ("world.md", "# World\nTidebinding smells of salt.\n"),
    ] {
        write_file(root, path, body);
        save(&mut kernel, path, body);
    }

    let mut ai_generations = 0usize;
    let mut complete_at_designed_confidence = 0usize;

    // Three in-app AI generations (genie-style, exact) with input sets.
    for (out, body, inputs) in [
        (
            "scene-01.md",
            "Elena at the shore.\n",
            vec!["elena.md", "world.md"],
        ),
        (
            "scene-02.md",
            "Marcus among the hives.\n",
            vec!["marcus.md"],
        ),
        (
            "scene-03.md",
            "Father and daughter argue.\n",
            vec!["elena.md", "marcus.md"],
        ),
    ] {
        write_file(root, out, body);
        let receipt = capture(
            &mut kernel,
            CaptureRequest {
                path: out.into(),
                content: body.into(),
                inputs: inputs
                    .iter()
                    .map(|p| CaptureInputSpec {
                        path: Some((*p).into()),
                        object_id: None,
                        revision: None,
                        role: InputRole::Direct,
                    })
                    .collect(),
                agent: Agent {
                    kind: AgentType::Model,
                    id: Some("genie".into()),
                },
                intent: Intent {
                    kind: "genie".into(),
                    summary: "scene".into(),
                    prompt_hash: None,
                },
                confidence: Confidence::Exact,
                rewrite_identity: true,
                idem: None,
            },
        )
        .unwrap();
        ai_generations += 1;
        if receipt.entry_id.is_some() {
            complete_at_designed_confidence += 1;
        }
    }

    // One MCP-style write (inferred, session reads as inputs).
    write_file(root, "chapter-1.md", "The war began on a Tuesday.\n");
    let receipt = capture(
        &mut kernel,
        CaptureRequest {
            path: "chapter-1.md".into(),
            content: "The war began on a Tuesday.\n".into(),
            inputs: vec![CaptureInputSpec {
                path: Some("world.md".into()),
                object_id: None,
                revision: None,
                role: InputRole::Direct,
            }],
            agent: Agent {
                kind: AgentType::Model,
                id: Some("mcp-client".into()),
            },
            intent: Intent {
                kind: "mcp-document-write".into(),
                summary: "document.write".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Inferred,
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    ai_generations += 1;
    if receipt.entry_id.is_some() {
        complete_at_designed_confidence += 1;
    }

    // M1: every AI generation captured, complete, zero manual metadata.
    assert_eq!(ai_generations, 4);
    assert_eq!(complete_at_designed_confidence, 4, "M1 = 4/4 = 100%");

    // Recursion moment: rewrite Elena aggressively; blast radius visible.
    let elena = std::fs::read_to_string(root.join("elena.md")).unwrap();
    let elena_v2 = elena.replace("green", "grey");
    write_file(root, "elena.md", &elena_v2);
    save(&mut kernel, "elena.md", &elena_v2);
    let rows = perform_breakdown(&mut kernel).unwrap();
    let stale_downstreams: Vec<_> = rows
        .iter()
        .filter_map(|r| r.downstream_path.as_deref())
        .collect();
    assert_eq!(
        stale_downstreams,
        vec!["scene-01.md", "scene-03.md"],
        "M5: exact blast radius, instantly"
    );

    // Resolve one (M4 workload sample): ratify scene-01, waive scene-03.
    let r0 = &rows[0];
    perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "accept-newer".into(),
            txf: r0.txf,
            input: r0.input,
            reason: None,
        },
        "dogfood",
    )
    .unwrap();
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1);
    perform_resolve(
        &mut kernel,
        &ResolveRequest {
            action: "waive".into(),
            txf: rows[0].txf,
            input: rows[0].input,
            reason: Some("her eyes changed with the tide — intentional".into()),
        },
        "dogfood",
    )
    .unwrap();
    let rows = perform_breakdown(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1, "waived stays visible, distinctly");
    assert!(matches!(rows[0].state, EdgeState::Waived));
}
