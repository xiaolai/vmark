// WI-1.4 — revision DAG: heads, ancestor queries, and context-relative
// selection resolution over linear / branched / incomparable / multi-head
// histories (spec §9.2/§9.3).

use super::*;
use crate::coherence::types::ContentHash;

fn oid(n: u8) -> ObjectId {
    ObjectId(uuid::Uuid::from_u128(n as u128))
}

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn rev(n: u8, parents: &[RevisionId]) -> RevisionId {
    RevisionId::compute(&hash(n), parents)
}

/// Linear: r0 -> r1 -> r2
fn linear(dag: &mut RevisionDag) -> (RevisionId, RevisionId, RevisionId) {
    let r0 = rev(0, &[]);
    let r1 = rev(1, std::slice::from_ref(&r0));
    let r2 = rev(2, std::slice::from_ref(&r1));
    dag.record_output(oid(1), r0.clone(), vec![]);
    dag.record_output(oid(1), r1.clone(), vec![r0.clone()]);
    dag.record_output(oid(1), r2.clone(), vec![r1.clone()]);
    (r0, r1, r2)
}

#[test]
fn linear_history_has_single_head_and_ancestry() {
    let mut dag = RevisionDag::default();
    let (r0, r1, r2) = linear(&mut dag);
    assert_eq!(dag.heads(&oid(1)), vec![r2.clone()]);
    assert!(dag.is_ancestor(&oid(1), &r0, &r2));
    assert!(dag.is_ancestor(&oid(1), &r1, &r2));
    assert!(!dag.is_ancestor(&oid(1), &r2, &r0));
    assert!(
        !dag.is_ancestor(&oid(1), &r2, &r2),
        "strict ancestry: self is not ancestor"
    );
}

#[test]
fn branched_history_has_two_heads_and_incomparable_tips() {
    let mut dag = RevisionDag::default();
    let (r0, _r1, r2) = linear(&mut dag);
    let fork = rev(9, std::slice::from_ref(&r0));
    dag.record_output(oid(1), fork.clone(), vec![r0.clone()]);
    let mut heads = dag.heads(&oid(1));
    heads.sort();
    let mut expected = vec![r2.clone(), fork.clone()];
    expected.sort();
    assert_eq!(heads, expected);
    assert!(!dag.is_ancestor(&oid(1), &fork, &r2));
    assert!(!dag.is_ancestor(&oid(1), &r2, &fork));
    assert!(dag.is_ancestor(&oid(1), &r0, &fork));
}

#[test]
fn merge_revision_unifies_heads() {
    let mut dag = RevisionDag::default();
    let (r0, _r1, r2) = linear(&mut dag);
    let fork = rev(9, std::slice::from_ref(&r0));
    dag.record_output(oid(1), fork.clone(), vec![r0.clone()]);
    let merge = rev(10, &[r2.clone(), fork.clone()]);
    dag.record_output(oid(1), merge.clone(), vec![r2.clone(), fork.clone()]);
    assert_eq!(dag.heads(&oid(1)), vec![merge.clone()]);
    assert!(dag.is_ancestor(&oid(1), &r2, &merge));
    assert!(dag.is_ancestor(&oid(1), &fork, &merge));
}

#[test]
fn record_output_is_idempotent() {
    let mut dag = RevisionDag::default();
    let r0 = rev(0, &[]);
    dag.record_output(oid(1), r0.clone(), vec![]);
    dag.record_output(oid(1), r0.clone(), vec![]);
    assert_eq!(dag.heads(&oid(1)), vec![r0.clone()]);
    assert_eq!(dag.revision_count(&oid(1)), 1);
}

#[test]
fn objects_are_isolated() {
    let mut dag = RevisionDag::default();
    let (r0, _r1, r2) = linear(&mut dag);
    let other = rev(7, &[]);
    dag.record_output(oid(2), other.clone(), vec![]);
    assert_eq!(dag.heads(&oid(2)), vec![other.clone()]);
    assert!(
        !dag.is_ancestor(&oid(2), &r0, &r2),
        "ancestry never crosses objects"
    );
}

#[test]
fn unknown_object_has_no_heads() {
    let dag = RevisionDag::default();
    assert!(dag.heads(&oid(42)).is_empty());
    assert!(!dag.contains(&oid(42), &rev(0, &[])));
}

#[test]
fn resolve_live_single_head() {
    let mut dag = RevisionDag::default();
    let (_r0, _r1, r2) = linear(&mut dag);
    let ctx = ContextView::all_live();
    assert_eq!(resolve(&ctx, &dag, &oid(1)), Resolved::Single(r2));
}

#[test]
fn resolve_live_multi_head_is_diverged_heads() {
    let mut dag = RevisionDag::default();
    let (r0, _r1, _r2) = linear(&mut dag);
    let fork = rev(9, std::slice::from_ref(&r0));
    dag.record_output(oid(1), fork, vec![r0]);
    assert_eq!(
        resolve(&ContextView::all_live(), &dag, &oid(1)),
        Resolved::DivergedHeads
    );
}

#[test]
fn resolve_pinned_wins_over_live_and_validates_membership() {
    let mut dag = RevisionDag::default();
    let (r0, _r1, _r2) = linear(&mut dag);
    let mut ctx = ContextView::all_live();
    ctx.pin(oid(1), r0.clone());
    assert_eq!(resolve(&ctx, &dag, &oid(1)), Resolved::Single(r0));
    // A pin to a revision this object never had is surfaced, never guessed.
    let foreign = rev(99, &[]);
    ctx.pin(oid(1), foreign);
    assert_eq!(resolve(&ctx, &dag, &oid(1)), Resolved::UnknownPin);
}

#[test]
fn resolve_object_with_no_revisions_is_absent() {
    let dag = RevisionDag::default();
    assert_eq!(
        resolve(&ContextView::all_live(), &dag, &oid(5)),
        Resolved::Absent
    );
}

#[test]
fn deep_chain_ancestor_walk_terminates() {
    // 500 revisions (spec §10 p95) — the BFS must stay linear.
    let mut dag = RevisionDag::default();
    let mut prev = rev(0, &[]);
    dag.record_output(oid(1), prev.clone(), vec![]);
    let root = prev.clone();
    for i in 0..500u32 {
        let h = ContentHash::parse(&format!("sha256:{}", format!("{:08x}", i).repeat(8))).unwrap();
        let r = RevisionId::compute(&h, std::slice::from_ref(&prev));
        dag.record_output(oid(1), r.clone(), vec![prev.clone()]);
        prev = r;
    }
    assert!(dag.is_ancestor(&oid(1), &root, &prev));
    assert!(!dag.is_ancestor(&oid(1), &prev, &root));
}
