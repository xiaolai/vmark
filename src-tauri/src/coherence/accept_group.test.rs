// Multi-object group-commit — fresh commit, idempotent retry, partial-crash
// recovery, and the distinct-object invariant, against a real WorkspaceKernel.

use super::*;
use crate::coherence::dag::Resolved;
use crate::coherence::operator::Candidate;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, Intent, ObjectId, OutputRef,
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

    // Simulate a crash after preparing THIS group's first attempt and committing
    // ONLY member 0: append the durable prepare, then commit c0 with its
    // ATTEMPT-folded idem (exactly what accept_group writes), as a real partial
    // crash would leave it.
    let grp = group_id(&cands).unwrap();
    let snapshot =
        crate::coherence::group_prepare::compute_snapshot(kernel.index(), &cands).unwrap();
    let attempt_id = crate::coherence::group_prepare::attempt_id_for(&grp, &snapshot, None);
    let prepare = crate::coherence::group_prepare::GroupPrepare {
        group_id: grp.clone(),
        attempt_id: attempt_id.clone(),
        supersedes: None,
        members: cands
            .iter()
            .map(crate::coherence::group_prepare::PreparedMember::of)
            .collect(),
        snapshot,
    };
    crate::coherence::group_prepare::append_prepare(&mut kernel, &prepare).unwrap();
    let idem0 = member_idem(&cands[0], &attempt_id).unwrap();
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

    // Recovery: accept the full group. Member 0 is found present via the tip
    // attempt's idem (returns the ORIGINAL); member 1 completes now.
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
fn a_fresh_group_commit_writes_a_durable_prepare() {
    // #5: a fresh group commit records a durable group-prepare so recovery can
    // reconstruct the group from the ledger alone.
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let preview = kernel.index().project_group(&cands, NOW).unwrap();
    accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    let grp = group_id(&cands).unwrap();
    assert!(
        matches!(
            crate::coherence::group_prepare::find_latest(&kernel, &grp).unwrap(),
            crate::coherence::group_prepare::Lifecycle::Prepared(_)
        ),
        "a durable prepare must be recorded",
    );
}

#[test]
fn recovery_aborts_when_an_affected_object_drifted_externally() {
    // #6/#7: a prepared, partially-committed group whose affected context drifted
    // externally must ABORT — never commit against the changed context, never
    // stay stuck. The abort is durable (the latest lifecycle becomes Aborted).
    use crate::coherence::group_prepare;
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let grp = group_id(&cands).unwrap();

    // Prepare the group (first attempt), then commit ONLY member 0 (U) with its
    // ATTEMPT-folded idem — a real partial of that attempt.
    let snapshot = group_prepare::compute_snapshot(kernel.index(), &cands).unwrap();
    let attempt_id = group_prepare::attempt_id_for(&grp, &snapshot, None);
    let prepare = group_prepare::GroupPrepare {
        group_id: grp.clone(),
        attempt_id: attempt_id.clone(),
        supersedes: None,
        members: cands
            .iter()
            .map(group_prepare::PreparedMember::of)
            .collect(),
        snapshot,
    };
    group_prepare::append_prepare(&mut kernel, &prepare).unwrap();
    let idem0 = member_idem(&cands[0], &attempt_id).unwrap();
    let mut e0 = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(cands[0].to_transformation(Agent {
            kind: AgentType::Human,
            id: None,
        }))
        .unwrap(),
    );
    e0.idem = idem0;
    kernel.append_and_apply(&e0).unwrap();

    // EXTERNAL change: advance V (member 1's object) past v1.
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
                summary: "external".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    );
    kernel.append_and_apply(&v_new).unwrap();

    let preview = kernel.index().project_group(&cands, NOW).unwrap();
    let err = accept_group(&mut kernel, &cands, &preview, NOW).unwrap_err();
    assert!(err.contains("aborted"), "got: {err}");
    assert!(matches!(
        group_prepare::find_latest(&kernel, &grp).unwrap(),
        group_prepare::Lifecycle::Aborted(_)
    ));
}

#[test]
fn a_fresh_rerun_after_abort_supersedes_the_aborted_attempt_and_completes() {
    // #2/#5: after an attempt aborts, a fresh re-run is a NEW attempt that
    // SUPERSEDES the aborted one via the causal chain (not wall-clock) and
    // completes. The aborted attempt's members are not reused (attempt-folded).
    use crate::coherence::group_prepare;
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let grp = group_id(&cands).unwrap();

    // Attempt 1: prepare, then abort it (as a drift-recovery would).
    let snap = group_prepare::compute_snapshot(kernel.index(), &cands).unwrap();
    let a1 = group_prepare::attempt_id_for(&grp, &snap, None);
    group_prepare::append_prepare(
        &mut kernel,
        &group_prepare::GroupPrepare {
            group_id: grp.clone(),
            attempt_id: a1.clone(),
            supersedes: None,
            members: vec![],
            snapshot: snap,
        },
    )
    .unwrap();
    group_prepare::append_abort(&mut kernel, &grp, &a1).unwrap();
    assert!(matches!(
        group_prepare::find_latest(&kernel, &grp).unwrap(),
        group_prepare::Lifecycle::Aborted(_)
    ));

    // A fresh re-run supersedes a1 and commits all members.
    let preview = kernel.index().project_group(&cands, NOW).unwrap();
    let receipts = accept_group(&mut kernel, &cands, &preview, NOW).unwrap();
    assert!(receipts.iter().all(|r| r.committed));
    match group_prepare::find_latest(&kernel, &grp).unwrap() {
        group_prepare::Lifecycle::Prepared(p) => {
            assert_eq!(p.supersedes, Some(a1), "the fresh attempt supersedes a1")
        }
        _ => panic!("expected the fresh attempt to be the live tip"),
    }
}

#[test]
fn recover_group_completes_a_partial_from_the_manifest_without_the_client() {
    // #6: a partial group is completed by recover_group from the durable manifest
    // + CAS ALONE — no client candidate list resubmitted.
    use crate::coherence::group_prepare;
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let cands = group(u, v, &u1, &v1);
    let grp = group_id(&cands).unwrap();
    let snapshot = group_prepare::compute_snapshot(kernel.index(), &cands).unwrap();
    let attempt_id = group_prepare::attempt_id_for(&grp, &snapshot, None);
    let prepare = group_prepare::GroupPrepare {
        group_id: grp.clone(),
        attempt_id: attempt_id.clone(),
        supersedes: None,
        members: cands
            .iter()
            .map(group_prepare::PreparedMember::of)
            .collect(),
        snapshot,
    };
    // Stage every member's content in CAS (as accept_group's fresh path does) —
    // recover_group reads the content back from CAS, not from the ledger.
    for c in &cands {
        kernel.snapshots().put_text(&c.content).unwrap();
    }
    group_prepare::append_prepare(&mut kernel, &prepare).unwrap();
    // Commit ONLY member 0 (U).
    let idem0 = member_idem(&cands[0], &attempt_id).unwrap();
    let mut e0 = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(cands[0].to_transformation(Agent {
            kind: AgentType::Human,
            id: None,
        }))
        .unwrap(),
    );
    e0.idem = idem0;
    kernel.append_and_apply(&e0).unwrap();

    // recover_group takes NO candidate list — it reconstructs from the manifest.
    let receipts = recover_group(&mut kernel, &grp, NOW).unwrap();
    assert_eq!(receipts.len(), 2);
    assert!(!receipts[0].committed, "member 0 already present");
    assert!(receipts[1].committed, "member 1 completed client-lessly");
    assert_eq!(
        kernel.index().resolve_live(&v).unwrap(),
        Resolved::Single(cands[1].revision.clone()),
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

#[test]
fn a_prepare_that_does_not_match_the_submitted_changeset_is_rejected() {
    // 7th-review 6R-3: a ledger prepare that merely names the same group_id — most
    // dangerously one with `members: []`, whose empty snapshot revalidates
    // trivially — must NOT let a client commit an unreviewed set through the
    // RECOVERY path, which skips the fresh preview-class precondition entirely.
    let (_dir, mut kernel, u, v, u1, v1) = seeded();
    let candidates = vec![
        Candidate::new(u, "U revised".into(), u1, vec![], "op", "s"),
        Candidate::new(v, "V revised".into(), v1, vec![], "op", "s"),
    ];
    // A prepare naming THIS group id, but carrying an empty manifest.
    let gid = group_id(&candidates).unwrap();
    let snapshot = group_prepare::GroupSnapshot {
        heads: vec![],
        affected_edges: vec![],
        resolution_digest: String::new(),
        earliest_expiry: None,
    };
    let prepare = GroupPrepare {
        group_id: gid.clone(),
        attempt_id: group_prepare::attempt_id_for(&gid, &snapshot, None),
        supersedes: None,
        members: vec![],
        snapshot,
    };
    group_prepare::append_prepare(&mut kernel, &prepare).unwrap();

    let preview = kernel.index().project_group(&candidates, NOW).unwrap();
    let err = accept_group(&mut kernel, &candidates, &preview, NOW).unwrap_err();
    assert!(
        err.contains("does not match the submitted changeset"),
        "the unmatched prepare must not commit an unreviewed set, got: {err}"
    );
}

#[test]
fn a_multi_parent_member_is_rejected_before_it_can_enter_a_group() {
    // H2 (G-B re-review 03): recovery's `to_candidate` refuses a member whose
    // transformation has >1 parent, so admitting one at fresh-accept would let a
    // crash strand a prepared group its own recovery path can never reconstruct.
    // Preflight must reject it up front — arity is checked before the live-head
    // resolve, so a fresh kernel suffices.
    let (_dir, kernel, u, _v, u1, _v1) = seeded();
    let mut c = Candidate::new(u, "U revised".into(), u1.clone(), vec![], "tidy", "s");
    c.parents.push(u1.clone()); // forge a second parent
    let err = preflight_member(&kernel, &c).unwrap_err();
    assert!(
        err.contains("multiple parents"),
        "expected arity rejection, got: {err}"
    );
}
