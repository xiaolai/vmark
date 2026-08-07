// WI-3.3 — operator verify: the D3 candidate-check PROMPT assembly (the testable
// half; the provider call is integration). Reads the declared-input texts from
// the CAS and fences everything as data.

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent, ObjectId,
    ObjectRegistered, OutputRef, RevisionId, Transformation, WriterId,
};

fn register(writer: WriterId, object: ObjectId, path: &str) -> Envelope {
    Envelope::create(
        "object-registered",
        writer,
        serde_json::to_value(ObjectRegistered {
            object,
            path: path.into(),
            schema: None,
            derived_from: None,
        })
        .unwrap(),
    )
}

fn txf(writer: WriterId, object: ObjectId, rev: RevisionId, content_hash: ContentHash) -> Envelope {
    Envelope::create(
        "transformation",
        writer,
        serde_json::to_value(Transformation {
            inputs: vec![],
            outputs: vec![OutputRef {
                object,
                revision: rev,
                content_hash,
                parents: vec![],
            }],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "seed".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    )
}

#[test]
fn prompt_includes_the_proposal_and_input_texts_fenced() {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();
    kernel.ensure_initialized().unwrap();

    // Seed an upstream U with content "Elena has brown eyes" in the CAS + index.
    let u = ObjectId(uuid::Uuid::now_v7());
    let u_hash = kernel.snapshots().put_text("Elena has brown eyes").unwrap();
    let u1 = RevisionId::compute(&u_hash, &[]);
    kernel
        .append_and_apply(&register(writer, u, "elena.md"))
        .unwrap();
    kernel
        .append_and_apply(&txf(writer, u, u1.clone(), u_hash))
        .unwrap();

    // A candidate for a downstream D that declares U@u1 as an input.
    let d = ObjectId(uuid::Uuid::now_v7());
    kernel
        .append_and_apply(&register(writer, d, "scene.md"))
        .unwrap();
    let candidate = Candidate::new(
        d,
        "Elena has green eyes".into(),
        RevisionId::compute(&ContentHash::from_digest(&[0u8; 32]), &[]),
        vec![InputRef {
            object: u,
            revision: u1,
            role: InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        "tidy",
        "s",
    );

    let prompt = build_candidate_prompt(&mut kernel, &candidate, "abc").unwrap();

    // The PROPOSAL and the declared-INPUT text are both present, fenced as data.
    assert!(prompt.contains("Elena has green eyes"), "proposal present");
    assert!(
        prompt.contains("Elena has brown eyes"),
        "input text loaded from CAS"
    );
    assert!(prompt.contains("<data-abc label=\"proposal\">"));
    assert!(prompt.contains("<data-abc label=\"input\">"));
    assert!(prompt.contains("scene.md"), "proposal path from registry");
    assert!(prompt.contains("PROPOSED"), "the D3 candidate-check prompt");
}

#[test]
fn prompt_with_no_declared_inputs_says_none() {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();
    kernel.ensure_initialized().unwrap();
    let d = ObjectId(uuid::Uuid::now_v7());
    let candidate = Candidate::new(
        d,
        "some text".into(),
        RevisionId::compute(&ContentHash::from_digest(&[1u8; 32]), &[]),
        vec![],
        "tidy",
        "s",
    );
    let prompt = build_candidate_prompt(&mut kernel, &candidate, "n").unwrap();
    assert!(prompt.contains("Declared inputs:\nNone."));
}
