// R4 (audit-fix) — the sweep's money-gating selection. Before this, no test
// proved that a non-actionable row (frozen downstream, or an anchor whose
// section did not move) is excluded from paid LLM checks while a version-stale,
// changed/lost-anchor row stays eligible. The whole point of routing the sweep
// through the enriched breakdown was to stop paying for suppressed work.

use super::select_checkable;
use crate::coherence::index_row::EdgeRow;
use crate::coherence::project::EdgeState;
use crate::coherence::types::{ObjectId, RevisionId};

fn rev() -> RevisionId {
    RevisionId::parse(&format!("rev1:{}", "a".repeat(64))).unwrap()
}

fn row(input: u32, state: EdgeState, actionable: bool) -> EdgeRow {
    EdgeRow {
        txf: uuid::Uuid::from_u128(input as u128 + 1),
        input,
        upstream: ObjectId(uuid::Uuid::from_u128(100)),
        upstream_path: None,
        pinned: rev(),
        downstream: ObjectId(uuid::Uuid::from_u128(200)),
        downstream_path: None,
        downstream_rev: rev(),
        confidence: "exact".into(),
        state,
        prior_waivers: 0,
        kind: "dependency".into(),
        frozen_downstream: false,
        anchor_status: None,
        actionable,
    }
}

#[test]
fn excludes_non_actionable_rows_even_when_version_stale() {
    // A version-stale edge IS checkable, but if it is not actionable (frozen or
    // unchanged-anchor) the sweep must not pay to check it.
    let rows = vec![row(0, EdgeState::VersionStale, false)];
    assert!(select_checkable(&rows).is_empty());
}

#[test]
fn keeps_actionable_version_stale_rows() {
    let rows = vec![row(0, EdgeState::VersionStale, true)];
    assert_eq!(select_checkable(&rows), vec![(uuid::Uuid::from_u128(1), 0)]);
}

#[test]
fn excludes_actionable_but_non_checkable_states() {
    // Waived/Diverged/Unpinnable have no single upstream revision to check;
    // actionability alone must not put them in a paid sweep.
    for state in [
        EdgeState::Waived,
        EdgeState::Diverged { multi_head: true },
        EdgeState::Unpinnable,
        EdgeState::Fresh {
            ratified: true,
            ahead: false,
        },
    ] {
        let rows = vec![row(0, state, true)];
        assert!(
            select_checkable(&rows).is_empty(),
            "non-checkable state leaked into the paid sweep"
        );
    }
}

#[test]
fn selects_only_the_intersection_across_a_mixed_set() {
    let rows = vec![
        row(0, EdgeState::VersionStale, true), // checkable + actionable → in
        row(1, EdgeState::VersionStale, false), // suppressed → out
        row(2, EdgeState::Waived, true),       // not checkable → out
        row(3, EdgeState::StaleValid, true),   // checkable + actionable → in
    ];
    let got = select_checkable(&rows);
    assert_eq!(
        got,
        vec![(uuid::Uuid::from_u128(1), 0), (uuid::Uuid::from_u128(4), 3)]
    );
}
