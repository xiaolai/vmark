// WI-AL2.1c — the changed runs of a certified map: one per maximal changed stretch, insertions and deletions at either end, and none for an identity map
//! Edge cases: an empty original; an insertion at offset 0 and at the end;
//! two edits that touch, which are one run.

use super::{ChangedRun, Provenance};
use crate::agent_journal::provenance::Section;
use crate::agent_journal::provenance::PROVENANCE_CAP;

fn map(len: i64, changes: &[&[(i64, i64, i64, i64)]]) -> Provenance {
    let mut p = Provenance::new(len, PROVENANCE_CAP).unwrap();
    for tx in changes {
        let sections: Vec<Section> = tx
            .iter()
            .map(|&(from_a, to_a, from_b, to_b)| Section {
                from_a,
                to_a,
                from_b,
                to_b,
            })
            .collect();
        p.compose(&sections).unwrap();
    }
    p
}

fn run(a: (i64, i64), b: (i64, i64)) -> ChangedRun {
    ChangedRun { a, b }
}

#[test]
fn an_identity_map_has_no_runs() {
    assert_eq!(map(4, &[]).changed_runs(), vec![]);
    assert_eq!(map(0, &[]).changed_runs(), vec![]);
}

#[test]
fn insertions_at_either_end_and_a_replacement_inside_are_runs() {
    // "abcd": insert 2 at 0 → "XXabcd"; replace "c" (4..5) by "YY"; append 1.
    let p = map(4, &[&[(0, 0, 0, 2)], &[(4, 5, 4, 6)], &[(7, 7, 7, 8)]]);
    assert_eq!(
        p.changed_runs(),
        vec![
            run((0, 0), (0, 2)),
            run((2, 3), (4, 6)),
            run((4, 4), (7, 8))
        ]
    );
}

#[test]
fn a_deletion_and_an_insertion_that_touch_are_one_run() {
    // "abcd": delete "b" (1..2), then insert "Z" at 2 (before "c").
    let p = map(4, &[&[(1, 2, 1, 1)], &[(1, 1, 1, 2)]]);
    assert_eq!(p.changed_runs(), vec![run((1, 2), (1, 2))]);
}

#[test]
fn an_empty_original_that_gains_text_is_one_run() {
    let p = map(0, &[&[(0, 0, 0, 3)]]);
    assert_eq!(p.changed_runs(), vec![run((0, 0), (0, 3))]);
}
