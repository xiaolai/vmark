// Multi-object group-commit — fresh commit, idempotent retry, partial-crash
// recovery, and the distinct-object invariant, against a real WorkspaceKernel.

use super::*;
use crate::coherence::dag::Resolved;
use crate::coherence::operator::Candidate;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, InputRef, InputRole, Intent, ObjectId, OutputRef,
    RevisionId, Transformation, WriterId,
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

    // Crash after committing only member 0 (a single-member group of [c0]).
    let just_first = vec![cands[0].clone()];
    let p1 = kernel.index().project_group(&just_first, NOW).unwrap();
    let r1 = accept_group(&mut kernel, &just_first, &p1, NOW).unwrap();
    assert!(r1[0].committed);

    // Recovery: accept the full group. Member 0 is present (original receipt),
    // member 1 is committed now.
    let recovered = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    assert!(!recovered[0].committed, "member 0 already present");
    assert_eq!(recovered[0].entry_id, r1[0].entry_id);
    assert!(recovered[1].committed, "member 1 completed on recovery");
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
fn an_empty_group_is_rejected() {
    let (_dir, mut kernel, _u, _v, _u1, _v1) = seeded();
    let empty: Vec<Candidate> = vec![];
    let preview = kernel.index().project_group(&empty, NOW).unwrap();
    assert!(accept_group(&mut kernel, &empty, &preview, NOW).is_err());
}
