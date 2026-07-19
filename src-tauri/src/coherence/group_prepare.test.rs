// Durable group-commit lifecycle (design-accept-consistency #5/#6/#7): the
// base-head/resolution snapshot detects external drift while treating a
// committed member's own head move as expected.

use super::*;
use crate::coherence::operator::Candidate;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, Intent, OutputRef, RevisionId,
    Transformation, WriterId,
};

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

fn seeded() -> (tempfile::TempDir, WorkspaceKernel, ObjectId, RevisionId) {
    let dir = tempfile::tempdir().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let mut kernel = WorkspaceKernel::open(dir.path(), writer).unwrap();
    kernel.ensure_initialized().unwrap();
    let u = ObjectId(uuid::Uuid::now_v7());
    kernel.append_and_apply(&seed_txf(writer, u, 1)).unwrap();
    let u1 = RevisionId::compute(&hash(1), &[]);
    (dir, kernel, u, u1)
}

#[test]
fn prepare_round_trips_through_the_ledger_and_find_latest() {
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = GroupPrepare {
        group_id: "g1".into(),
        members: vec![PreparedMember {
            object: cand.object,
            revision: cand.revision.clone(),
        }],
        snapshot,
    };
    append_prepare(&mut kernel, &prepare).unwrap();

    match find_latest(&kernel, "g1").unwrap() {
        Lifecycle::Prepared(p) => assert_eq!(*p, prepare),
        _ => panic!("expected a prepared lifecycle"),
    }
    // A different group has no record.
    assert!(matches!(
        find_latest(&kernel, "other").unwrap(),
        Lifecycle::None
    ));
}

#[test]
fn abort_supersedes_a_prepare_as_the_latest_record() {
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = GroupPrepare {
        group_id: "g1".into(),
        members: vec![],
        snapshot: snapshot.clone(),
    };
    append_prepare(&mut kernel, &prepare).unwrap();
    append_abort(&mut kernel, "g1", &snapshot).unwrap();
    assert!(matches!(
        find_latest(&kernel, "g1").unwrap(),
        Lifecycle::Aborted
    ));
}

#[test]
fn revalidate_accepts_a_committed_members_own_head_move_but_rejects_external_drift() {
    let (_dir, mut kernel, u, u1) = seeded();
    // A second object V that the group does NOT touch — an external write to it
    // must fail revalidation.
    let v = ObjectId(uuid::Uuid::now_v7());
    kernel
        .append_and_apply(&seed_txf(kernel.writer(), v, 2))
        .unwrap();
    let v1 = RevisionId::compute(&hash(2), &[]);

    // A candidate revising U, declaring a dependency on V@v1 (so V is affected).
    let dep = InputRef {
        object: v,
        revision: v1.clone(),
        role: crate::coherence::types::InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    };
    let cand = Candidate::new(u, "revised".into(), u1, vec![dep], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = GroupPrepare {
        group_id: "g1".into(),
        members: vec![PreparedMember {
            object: cand.object,
            revision: cand.revision.clone(),
        }],
        snapshot,
    };

    // Commit U as its member. Revalidation must ACCEPT (U's head move is the
    // group's own; V is unchanged).
    kernel
        .append_and_apply(&{
            let mut e = Envelope::create(
                "transformation",
                kernel.writer(),
                serde_json::to_value(cand.to_transformation(Agent {
                    kind: AgentType::Human,
                    id: None,
                }))
                .unwrap(),
            );
            e.idem = uuid::Uuid::now_v7();
            e
        })
        .unwrap();
    let committed = vec![(cand.object, cand.revision.clone())];
    assert!(
        revalidate(kernel.index(), &prepare, &committed).unwrap(),
        "a committed member's own head move must pass",
    );

    // Now an EXTERNAL write advances V past v1 — revalidation must REJECT.
    let v2 = {
        let revision = RevisionId::compute(&hash(9), std::slice::from_ref(&v1));
        Envelope::create(
            "transformation",
            kernel.writer(),
            serde_json::to_value(Transformation {
                inputs: vec![],
                outputs: vec![OutputRef {
                    object: v,
                    revision,
                    content_hash: hash(9),
                    parents: vec![v1.clone()],
                }],
                agent: Agent {
                    kind: AgentType::Human,
                    id: None,
                },
                intent: Intent {
                    kind: "test".into(),
                    summary: "external".into(),
                    prompt_hash: None,
                },
                confidence: Confidence::Exact,
            })
            .unwrap(),
        )
    };
    kernel.append_and_apply(&v2).unwrap();
    assert!(
        !revalidate(kernel.index(), &prepare, &committed).unwrap(),
        "an external head move on an affected object must fail revalidation",
    );
}
