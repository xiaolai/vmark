// WI-1.4 — edge-state projection (spec §9.2): liveness filtering, the
// Fresh/VersionStale/Diverged axis-1 states, resolution-record precedence
// (latest wins, expiry, reopening on upstream advance), check-verdict
// mapping, and both diverged sub-cases. Table-driven over linear,
// branched, incomparable, and multi-head histories.

use super::*;
use crate::coherence::dag::{ContextView, RevisionDag};
use crate::coherence::types::{ContentHash, InputRole, ObjectId, RevisionId};

fn oid(n: u8) -> ObjectId {
    ObjectId(uuid::Uuid::from_u128(n as u128))
}
fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}
fn rev(n: u8, parents: &[RevisionId]) -> RevisionId {
    RevisionId::compute(&hash(n), parents)
}

const UP: u8 = 1; // upstream object
const DOWN: u8 = 2; // downstream object

struct World {
    dag: RevisionDag,
    up0: RevisionId,
    up1: RevisionId,
    down0: RevisionId,
}

/// upstream: up0 -> up1 (advanced); downstream: down0 (current head).
fn world() -> World {
    let mut dag = RevisionDag::default();
    let up0 = rev(0, &[]);
    let up1 = rev(1, std::slice::from_ref(&up0));
    dag.record_output(oid(UP), up0.clone(), vec![]);
    dag.record_output(oid(UP), up1.clone(), vec![up0.clone()]);
    let down0 = rev(10, &[]);
    dag.record_output(oid(DOWN), down0.clone(), vec![]);
    World {
        dag,
        up0,
        up1,
        down0,
    }
}

fn edge(w: &World, pinned: &RevisionId) -> OriginEdge {
    OriginEdge {
        txf: uuid::Uuid::from_u128(77),
        input: 0,
        upstream: oid(UP),
        pinned: pinned.clone(),
        downstream: oid(DOWN),
        downstream_rev: w.down0.clone(),
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    }
}

/// Same as `edge` but with an arbitrary kind — for the inert-kind characterization.
fn edge_of_kind(
    w: &World,
    pinned: &RevisionId,
    kind: crate::coherence::edge_kind::OriginEdgeKind,
) -> OriginEdge {
    OriginEdge {
        kind,
        ..edge(w, pinned)
    }
}

fn resolution(kind: ResolutionKind, against: &RevisionId, t: &str, id: u128) -> EdgeResolution {
    EdgeResolution {
        kind,
        resolved_against: against.clone(),
        time: t.to_string(),
        id: uuid::Uuid::from_u128(id),
        expires: None,
    }
}

const NOW: &str = "2026-07-18T12:00:00Z";

fn project(
    w: &World,
    e: &OriginEdge,
    ctx: &ContextView,
    res: &[EdgeResolution],
    checks: &[EdgeCheck],
) -> Option<EdgeState> {
    project_edge(e, ctx, &w.dag, res, checks, NOW)
}

// WI-2.1 characterization: the edge kind gates the version axis. A dependency
// over an advanced upstream is VersionStale (today's behaviour, frozen); the same
// edge as an inert kind (part-of/mention) is never stale — Fresh in the
// projection. This is the only observable behaviour change of the Phase-2
// registry, and it is opt-in (nothing captures a non-dependency kind yet).
#[test]
fn dependency_over_advanced_upstream_is_version_stale() {
    use crate::coherence::edge_kind::OriginEdgeKind;
    let w = world();
    // pinned at up0, current head up1 (advanced) → version-stale, no verdict.
    let e = edge_of_kind(&w, &w.up0, OriginEdgeKind::Dependency);
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[]),
        Some(EdgeState::VersionStale)
    );
}

#[test]
fn inert_kind_over_advanced_upstream_is_never_stale() {
    use crate::coherence::edge_kind::OriginEdgeKind;
    let w = world();
    for kind in [OriginEdgeKind::PartOf, OriginEdgeKind::Mention] {
        let e = edge_of_kind(&w, &w.up0, kind);
        // Same advanced upstream, but an inert kind never enters the stale set.
        assert_eq!(
            project(&w, &e, &ContextView::all_live(), &[], &[]),
            Some(EdgeState::Fresh {
                ratified: false,
                ahead: false
            }),
            "{kind:?} must never be version-stale",
        );
    }
}

#[test]
fn inert_kind_still_surfaces_a_diverged_upstream() {
    use crate::coherence::edge_kind::OriginEdgeKind;
    let mut w = world();
    // Give the upstream a second head (up1b, sibling of up1 over up0).
    let up1b = rev(9, std::slice::from_ref(&w.up0));
    w.dag.record_output(oid(UP), up1b, vec![w.up0.clone()]);
    let e = edge_of_kind(&w, &w.up0, OriginEdgeKind::PartOf);
    // Divergence is structural, independent of kind — it still surfaces.
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[]),
        Some(EdgeState::Diverged { multi_head: true })
    );
}

#[test]
fn superseded_downstream_edge_is_not_live() {
    let mut w = world();
    // Downstream advances: the old edge retires (revise resolves this way).
    let down1 = rev(11, std::slice::from_ref(&w.down0));
    w.dag.record_output(oid(DOWN), down1, vec![w.down0.clone()]);
    let e = edge(&w, &w.up0);
    assert_eq!(project(&w, &e, &ContextView::all_live(), &[], &[]), None);
}

#[test]
fn contextual_inputs_are_provenance_not_edges() {
    let w = world();
    let mut e = edge(&w, &w.up0);
    e.role = InputRole::Contextual;
    assert_eq!(project(&w, &e, &ContextView::all_live(), &[], &[]), None);
}

#[test]
fn pin_equal_to_selection_is_fresh() {
    let w = world();
    let e = edge(&w, &w.up1); // pinned at current head
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[]),
        Some(EdgeState::Fresh {
            ratified: false,
            ahead: false
        })
    );
}

#[test]
fn upstream_advance_makes_version_stale() {
    let w = world();
    let e = edge(&w, &w.up0); // world moved to up1
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[]),
        Some(EdgeState::VersionStale)
    );
}

#[test]
fn ratification_against_selection_is_fresh_ratified() {
    let w = world();
    let e = edge(&w, &w.up0);
    let r = resolution(
        ResolutionKind::Ratification,
        &w.up1,
        "2026-07-18T10:00:00Z",
        1,
    );
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[r], &[]),
        Some(EdgeState::Fresh {
            ratified: true,
            ahead: false
        })
    );
}

#[test]
fn latest_resolution_wins_waiver_supersedes_ratification() {
    let w = world();
    let e = edge(&w, &w.up0);
    let older = resolution(
        ResolutionKind::Ratification,
        &w.up1,
        "2026-07-18T10:00:00Z",
        1,
    );
    let newer = resolution(ResolutionKind::Waiver, &w.up1, "2026-07-18T11:00:00Z", 2);
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[older, newer], &[]),
        Some(EdgeState::Waived)
    );
}

#[test]
fn expired_waiver_reverts_to_version_stale() {
    let w = world();
    let e = edge(&w, &w.up0);
    let mut waiver = resolution(ResolutionKind::Waiver, &w.up1, "2026-07-18T10:00:00Z", 1);
    waiver.expires = Some("2026-07-18T11:00:00Z".to_string()); // before NOW
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[waiver], &[]),
        Some(EdgeState::VersionStale)
    );
}

#[test]
fn upstream_advance_past_resolution_reopens_the_edge() {
    let mut w = world();
    let e = edge(&w, &w.up0);
    // Ratified against up1, then upstream advances to up2.
    let r = resolution(
        ResolutionKind::Ratification,
        &w.up1,
        "2026-07-18T10:00:00Z",
        1,
    );
    let up2 = rev(2, std::slice::from_ref(&w.up1));
    w.dag.record_output(oid(UP), up2, vec![w.up1.clone()]);
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[r], &[]),
        Some(EdgeState::VersionStale)
    );
}

#[test]
fn incomparable_pin_and_selection_is_diverged_single() {
    let mut w = world();
    // Fork the upstream from up0: fork is incomparable with up1.
    let fork = rev(9, std::slice::from_ref(&w.up0));
    w.dag
        .record_output(oid(UP), fork.clone(), vec![w.up0.clone()]);
    // Pin the CONTEXT to up1 so selection is defined while the edge pinned the fork.
    let mut ctx = ContextView::all_live();
    ctx.pin(oid(UP), w.up1.clone());
    let e = edge(&w, &fork);
    assert_eq!(
        project(&w, &e, &ctx, &[], &[]),
        Some(EdgeState::Diverged { multi_head: false })
    );
}

#[test]
fn multi_head_live_upstream_is_diverged_multi_head() {
    let mut w = world();
    let fork = rev(9, std::slice::from_ref(&w.up0));
    w.dag.record_output(oid(UP), fork, vec![w.up0.clone()]);
    let e = edge(&w, &w.up0);
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[]),
        Some(EdgeState::Diverged { multi_head: true })
    );
}

#[test]
fn pin_newer_than_selection_is_fresh_ahead() {
    let w = world();
    let mut ctx = ContextView::all_live();
    ctx.pin(oid(UP), w.up0.clone()); // context looks at the past
    let e = edge(&w, &w.up1); // edge was built against the newer revision
    assert_eq!(
        project(&w, &e, &ctx, &[], &[]),
        Some(EdgeState::Fresh {
            ratified: false,
            ahead: true
        })
    );
}

#[test]
fn check_verdicts_map_to_axis_two_states() {
    let w = world();
    let e = edge(&w, &w.up0);
    let mk = |verdict, t: &str, id| EdgeCheck {
        pinned: w.up0.clone(),
        checked_against: w.up1.clone(),
        verdict,
        time: t.to_string(),
        id: uuid::Uuid::from_u128(id),
    };
    for (verdict, expected) in [
        (CheckVerdict::NoContradiction, EdgeState::StaleValid),
        (CheckVerdict::Contradiction, EdgeState::StaleContradicted),
        (CheckVerdict::Unknown, EdgeState::StaleUnknown),
    ] {
        let c = mk(verdict, "2026-07-18T10:00:00Z", 1);
        assert_eq!(
            project(&w, &e, &ContextView::all_live(), &[], &[c]),
            Some(expected)
        );
    }
    // Expired check (endpoints moved): checked_against no longer the selection.
    let stale_check = EdgeCheck {
        pinned: w.up0.clone(),
        checked_against: w.up0.clone(),
        verdict: CheckVerdict::Contradiction,
        time: "2026-07-18T10:00:00Z".to_string(),
        id: uuid::Uuid::from_u128(9),
    };
    assert_eq!(
        project(&w, &e, &ContextView::all_live(), &[], &[stale_check]),
        Some(EdgeState::VersionStale)
    );
}

#[test]
fn unknown_pin_surfaces_unpinnable() {
    let w = world();
    let mut ctx = ContextView::all_live();
    ctx.pin(oid(UP), rev(99, &[])); // revision the object never had
    let e = edge(&w, &w.up0);
    assert_eq!(project(&w, &e, &ctx, &[], &[]), Some(EdgeState::Unpinnable));
}

#[test]
fn multi_head_downstream_suppresses_its_edges() {
    // Spec §9.2 strict liveness: with resolve(C, D) undefined
    // (DivergedHeads), no downstream revision "equals" the selection —
    // the edge is suppressed; the divergence shows where D is upstream.
    let mut w = world();
    let sibling = rev(12, &[]);
    w.dag.record_output(oid(DOWN), sibling, vec![]);
    let e = edge(&w, &w.up1);
    assert_eq!(project(&w, &e, &ContextView::all_live(), &[], &[]), None);
}
