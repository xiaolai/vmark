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

const NOW: &str = "2026-07-20T00:00:00Z";

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

/// Build a first-attempt prepare (attempt_id derived from the snapshot).
fn prep(group_id: &str, members: Vec<PreparedMember>, snapshot: GroupSnapshot) -> GroupPrepare {
    let attempt_id = attempt_id_for(group_id, &snapshot, None);
    GroupPrepare {
        group_id: group_id.into(),
        attempt_id,
        supersedes: None,
        members,
        snapshot,
    }
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
    let prepare = prep(
        "g1",
        vec![PreparedMember {
            object: cand.object,
            revision: cand.revision.clone(),
        }],
        snapshot,
    );
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
fn a_malformed_prepare_is_quarantined_and_does_not_poison_find_latest() {
    // Re-review #7: a group-prepare body without a well-formed snapshot must be
    // QUARANTINED at read (never applied), so it cannot break find_latest for a
    // group that also has a valid record.
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = prep("g", vec![], snapshot);
    append_prepare(&mut kernel, &prepare).unwrap();

    // A malformed group-prepare (no snapshot) — append_and_apply quarantines it
    // internally and still returns Ok.
    let mut bad = Envelope::create(
        "group-prepare",
        kernel.writer(),
        serde_json::json!({ "group_id": "g", "members": [] }),
    );
    bad.idem = uuid::Uuid::now_v7();
    kernel.append_and_apply(&bad).unwrap();

    // find_latest still returns the valid prepare — not poisoned.
    assert!(matches!(
        find_latest(&kernel, "g").unwrap(),
        Lifecycle::Prepared(_)
    ));
}

#[test]
fn find_latest_fails_closed_on_a_forked_lifecycle() {
    // Re-review #2: two branches both supersede the same attempt (a git merge of
    // two clones that each group-committed) → two maximal tips. `find_latest`
    // must fail closed, never pick one by hash order.
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snap = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let a1 = attempt_id_for("g", &snap, None);
    // Two branches, each re-previewed to a slightly different snapshot, both
    // superseding a1 → two honest, distinct attempts (a git-merge fork).
    let mut snap_c = snap.clone();
    snap_c.earliest_expiry = Some("2027-01-01T00:00:00Z".into());
    let b = GroupPrepare {
        group_id: "g".into(),
        attempt_id: attempt_id_for("g", &snap, Some(&a1)),
        supersedes: Some(a1.clone()),
        members: vec![],
        snapshot: snap,
    };
    let c = GroupPrepare {
        group_id: "g".into(),
        attempt_id: attempt_id_for("g", &snap_c, Some(&a1)),
        supersedes: Some(a1),
        members: vec![],
        snapshot: snap_c,
    };
    append_prepare(&mut kernel, &b).unwrap();
    append_prepare(&mut kernel, &c).unwrap();
    assert!(
        find_latest(&kernel, "g").is_err(),
        "a forked lifecycle must fail closed, not hash-pick a tip",
    );
}

#[test]
fn revalidate_rejects_an_external_new_incident_edge() {
    // Re-review #3b: an external transformation creates a NEW edge incident to an
    // affected object (a new downstream depending on it) without advancing that
    // object's head — the frozen prepare-time edge list misses it, so revalidate
    // must reject the current-incident-edge set.
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = prep(
        "g",
        vec![PreparedMember {
            object: cand.object,
            revision: cand.revision.clone(),
        }],
        snapshot,
    );
    // Commit U as its member.
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
    let member_entry = e.id;
    kernel.append_and_apply(&e).unwrap();
    let committed = vec![(cand.object, cand.revision.clone(), member_entry)];
    assert!(revalidate(kernel.index(), &prepare, &committed, NOW).unwrap());

    // EXTERNAL: a new object W depends on U@cand.revision → a new edge incident
    // to the affected object U (downstream W is not a committed member).
    let w = ObjectId(uuid::Uuid::now_v7());
    let w_txf = Transformation {
        inputs: vec![InputRef {
            object: cand.object,
            revision: cand.revision.clone(),
            role: crate::coherence::types::InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        outputs: vec![OutputRef {
            object: w,
            revision: RevisionId::compute(&hash(8), &[]),
            content_hash: hash(8),
            parents: vec![],
        }],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "test".into(),
            summary: "external downstream".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    };
    kernel
        .append_and_apply(&Envelope::create(
            "transformation",
            kernel.writer(),
            serde_json::to_value(&w_txf).unwrap(),
        ))
        .unwrap();
    assert!(
        !revalidate(kernel.index(), &prepare, &committed, NOW).unwrap(),
        "an external new incident edge on an affected object must abort",
    );
}

#[test]
fn revalidate_aborts_once_a_snapshotted_resolution_expiry_passes() {
    // Re-review #4: a waiver expiring is a time-only transition (no head or
    // resolution-id changes), so recovery must abort once `now` reaches the
    // earliest snapshotted expiry.
    let (_dir, kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let mut snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    snapshot.earliest_expiry = Some("2026-07-20T00:00:00Z".into());
    let prepare = prep("g", vec![], snapshot);
    // Before the expiry → passes (no other drift, no committed members).
    assert!(revalidate(kernel.index(), &prepare, &[], "2026-07-19T23:59:59Z").unwrap());
    // At/after the expiry → aborts.
    assert!(!revalidate(kernel.index(), &prepare, &[], "2026-07-20T00:00:00Z").unwrap());

    // Mixed-offset: expiry 01:00+02:00 == 23:00Z; now 00:30Z is AFTER it, though
    // lexicographically "00" < "01" would wrongly pass. Instant compare aborts.
    let mut off = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    off.earliest_expiry = Some("2026-07-20T01:00:00+02:00".into());
    let prep_off = prep("g", vec![], off);
    assert!(
        !revalidate(kernel.index(), &prep_off, &[], "2026-07-20T00:30:00Z").unwrap(),
        "a +02:00 expiry already past in UTC must abort (chronological, not lexical)",
    );
}

#[test]
fn abort_supersedes_a_prepare_as_the_latest_record() {
    let (_dir, mut kernel, u, u1) = seeded();
    let cand = Candidate::new(u, "revised".into(), u1, vec![], "op", "s");
    let snapshot = compute_snapshot(kernel.index(), std::slice::from_ref(&cand)).unwrap();
    let prepare = prep("g1", vec![], snapshot);
    append_prepare(&mut kernel, &prepare).unwrap();
    append_abort(&mut kernel, "g1", &prepare.attempt_id).unwrap();
    assert!(matches!(
        find_latest(&kernel, "g1").unwrap(),
        Lifecycle::Aborted(_)
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
    let prepare = prep(
        "g1",
        vec![PreparedMember {
            object: cand.object,
            revision: cand.revision.clone(),
        }],
        snapshot,
    );

    // Commit U as its member. Revalidation must ACCEPT (U's head move is the
    // group's own; V is unchanged).
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
    let member_entry = e.id;
    kernel.append_and_apply(&e).unwrap();
    let committed = vec![(cand.object, cand.revision.clone(), member_entry)];
    assert!(
        revalidate(kernel.index(), &prepare, &committed, NOW).unwrap(),
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
        !revalidate(kernel.index(), &prepare, &committed, NOW).unwrap(),
        "an external head move on an affected object must fail revalidation",
    );
}
