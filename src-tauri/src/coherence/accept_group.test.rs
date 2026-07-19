// Multi-object group-commit — fresh commit, idempotent retry, partial-crash
// recovery, and the distinct-object invariant, against a real WorkspaceKernel.

use super::*;
use crate::coherence::dag::Resolved;
use crate::coherence::operator::Candidate;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, InputRef, Intent, ObjectId, OutputRef, RevisionId,
    Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn seed_txf(writer: WriterId, object: ObjectId, n: u8) -> Envelope {
    let revision = RevisionId::compute(&hash(n), &[]);
    Envelope::create(
        "transformation",
        writer,
        serde_json::to_value(Transformation {
            inputs: Vec::<InputRef>::new(),
            outputs: vec![OutputRef {
                object,
                revision,
                content_hash: hash(n),
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

/// Kernel with two existing objects U@u1 and V@v1.
fn seeded() -> (
    tempfile::TempDir,
    WorkspaceKernel,
    ObjectId,
    ObjectId,
    RevisionId,
    RevisionId,
) {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();
    let u = ObjectId(uuid::Uuid::now_v7());
    let v = ObjectId(uuid::Uuid::now_v7());
    kernel.append_and_apply(&seed_txf(writer, u, 1)).unwrap();
    kernel.append_and_apply(&seed_txf(writer, v, 2)).unwrap();
    let u1 = RevisionId::compute(&hash(1), &[]);
    let v1 = RevisionId::compute(&hash(2), &[]);
    (dir, kernel, u, v, u1, v1)
}

fn group(u: ObjectId, v: ObjectId, u1: &RevisionId, v1: &RevisionId) -> Vec<Candidate> {
    vec![
        Candidate::new(u, "U revised".into(), u1.clone(), vec![], "tidy", "s"),
        Candidate::new(v, "V revised".into(), v1.clone(), vec![], "tidy", "s"),
    ]
}

#[test]
fn group_commits_all_members() {
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let preview = kernel.index().project_group(&cands, NOW).unwrap();

    let receipts = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    assert_eq!(receipts.len(), 2);
    assert!(receipts.iter().all(|r| r.committed));
    // Both objects now resolve to their candidate revisions.
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(cands[0].revision.clone())
    );
    assert_eq!(
        kernel.index().resolve_live(&v).unwrap(),
        Resolved::Single(cands[1].revision.clone())
    );
}

#[test]
fn a_full_group_retry_returns_originals_and_does_not_double_append() {
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let preview = kernel.index().project_group(&cands, NOW).unwrap();

    let first = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    let retry = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    assert!(retry.iter().all(|r| !r.committed), "retry appends nothing");
    assert_eq!(
        first.iter().map(|r| r.entry_id).collect::<Vec<_>>(),
        retry.iter().map(|r| r.entry_id).collect::<Vec<_>>(),
        "retry returns the ORIGINAL entry ids",
    );
}

#[test]
fn a_partial_group_is_completed_on_recovery() {
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let preview = kernel.index().project_group(&cands, NOW).unwrap();

    // Simulate a crash after committing ONLY member 0 of THIS group: append its
    // transformation with the GROUP-FOLDED idem (exactly what commit_member
    // writes), as a real partial crash would leave it. (A single-member group
    // would have a different group id — that is the point of #1.)
    let grp = group_id(&cands).unwrap();
    let idem0 = member_idem(&cands[0], &grp).unwrap();
    let txf0 = cands[0].to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    let mut env0 = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&txf0).unwrap(),
    );
    env0.idem = idem0;
    let e0_id = env0.id;
    kernel.append_and_apply(&env0).unwrap();
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(cands[0].revision.clone())
    );

    // Recovery: accept the full group. Member 0 is found present via its
    // group-folded idem (returns the ORIGINAL); member 1 completes now.
    let recovered = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    assert!(
        !recovered[0].committed,
        "member 0 already present (this group's idem)"
    );
    assert_eq!(recovered[0].entry_id, e0_id);
    assert!(recovered[1].committed, "member 1 completed on recovery");
    assert_eq!(
        kernel.index().resolve_live(&v).unwrap(),
        Resolved::Single(cands[1].revision.clone())
    );
}

#[test]
fn a_stale_member_rejects_the_whole_group_before_any_commit() {
    // Whole-group preflight (#2): if any member's base is stale, the group is
    // rejected BEFORE any member is appended — never a partial commit.
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let preview = kernel.index().project_group(&cands, NOW).unwrap();

    // A concurrent write advances V past v1 — member 1's base is now stale.
    let v_new = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(Transformation {
            inputs: vec![],
            outputs: vec![OutputRef {
                object: v,
                revision: RevisionId::compute(&hash(9), std::slice::from_ref(&v1)),
                content_hash: hash(9),
                parents: vec![v1.clone()],
            }],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "advance".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    );
    kernel.append_and_apply(&v_new).unwrap();

    let err = accept_group(&mut kernel, &cands, &preview, NOW).unwrap_err();
    assert!(err.contains("stale"), "got: {err}");
    // No partial commit: U (member 0) stays at its base.
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(u1.clone()),
    );
}

#[test]
fn a_new_edge_going_stale_between_preview_and_accept_is_rejected() {
    // Re-review #8: a member's NEW input edge pinned to an external upstream can
    // go stale even when the member's own base head is unchanged. Here U has no
    // committed incident edges (base_classes stays empty), so ONLY the new-edge
    // re-check can catch V advancing — proving #8.
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let dep = InputRef {
        object: v,
        revision: v1.clone(),
        role: crate::coherence::types::InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    };
    let candidate = Candidate::new(u, "U revised".into(), u1.clone(), vec![dep], "op", "s");
    let grp = vec![candidate];
    let preview = kernel.index().project_group(&grp, NOW).unwrap();

    // Advance V past v1 AFTER the preview — the new edge U→V@v1 is now stale,
    // but U's base head (u1) is unchanged.
    let v2 = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(Transformation {
            inputs: vec![],
            outputs: vec![OutputRef {
                object: v,
                revision: RevisionId::compute(&hash(9), std::slice::from_ref(&v1)),
                content_hash: hash(9),
                parents: vec![v1.clone()],
            }],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "advance".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    );
    kernel.append_and_apply(&v2).unwrap();

    let err = accept_group(&mut kernel, &grp, &preview, NOW).unwrap_err();
    assert!(
        err.contains("new-edge") || err.contains("re-preview"),
        "got: {err}"
    );
    // U was NOT committed.
    assert_eq!(
        kernel.index().resolve_live(&u).unwrap(),
        Resolved::Single(u1.clone()),
    );
}

#[test]
fn a_group_with_a_duplicate_object_is_rejected() {
    let (_dir, mut kernel, u, _v, u1, _v1) = seeded();
    let dup = vec![
        Candidate::new(u, "a".into(), u1.clone(), vec![], "tidy", "s"),
        Candidate::new(u, "b".into(), u1.clone(), vec![], "tidy", "s"),
    ];
    let preview = kernel.index().project_group(&dup, NOW).unwrap();
    let err = accept_group(&mut kernel, &dup, &preview, NOW).unwrap_err();
    assert!(err.contains("same object"), "got: {err}");
}

#[test]
fn group_id_binds_full_member_identity_not_just_revisions() {
    // Re-review #4: `revision` is content+parents only, so two candidates can
    // share a revision yet be different transformations (different inputs). The
    // group id must bind the FULL member identity, so they get distinct ids.
    let (_dir, _kernel, u, v, u1, v1) = seeded();
    let a = Candidate::new(u, "same".into(), u1.clone(), vec![], "op", "s");
    let extra = InputRef {
        object: v,
        revision: v1.clone(),
        role: crate::coherence::types::InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Conformance,
    };
    let b = Candidate::new(u, "same".into(), u1.clone(), vec![extra], "op", "s");
    assert_eq!(a.revision, b.revision, "same content+base → same revision");
    assert_ne!(
        group_id(std::slice::from_ref(&a)).unwrap(),
        group_id(std::slice::from_ref(&b)).unwrap(),
        "different inputs must change the group id (#4)",
    );
}

#[test]
fn an_empty_group_is_rejected() {
    let (_dir, mut kernel, _u, _v, _u1, _v1) = seeded();
    let empty: Vec<Candidate> = vec![];
    let preview = kernel.index().project_group(&empty, NOW).unwrap();
    assert!(accept_group(&mut kernel, &empty, &preview, NOW).is_err());
}
