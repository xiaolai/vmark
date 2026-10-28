// One transaction with many disjoint ranges (a replace-all): every effect is recorded, and a transaction past the cap becomes a whole capOverflow barrier after work bounded by the cap, not by its ranges
use std::time::{Duration, Instant};

use super::pieces::{compose_pieces, validate_changes, Piece};
use super::{BreakReason, Provenance, Section, PROVENANCE_CAP};

/// Deletes every other character of a `2k`-character document, in one transaction.
fn every_other_deleted(k: i64) -> Vec<Section> {
    (0..k)
        .map(|i| Section {
            from_a: 2 * i,
            to_a: 2 * i + 1,
            from_b: i,
            to_b: i,
        })
        .collect()
}

/// The fastest of five runs, so a scheduler hiccup cannot decide the ratio.
fn fastest(mut run: impl FnMut()) -> Duration {
    (0..5)
        .map(|_| {
            let t = Instant::now();
            run();
            t.elapsed()
        })
        .min()
        .expect("five runs")
}

#[test]
fn records_every_deleted_character_of_the_transaction() {
    let k = 1000;
    let mut p = Provenance::new(2 * k, PROVENANCE_CAP).unwrap();
    p.compose(&every_other_deleted(k)).unwrap();
    assert_eq!(p.whole, None);
    assert_eq!(p.len_b, k);
    let want: Vec<_> = (0..k).map(|i| (2 * i, 2 * i)).collect();
    assert_eq!(p.deleted, want);
}

#[test]
fn merges_a_transactions_ranges_with_the_windows_earlier_effects() {
    let mut p = Provenance::new(10, PROVENANCE_CAP).unwrap();
    let del = |from_a, to_a, from_b| Section {
        from_a,
        to_a,
        from_b,
        to_b: from_b,
    };
    p.compose(&[del(4, 6, 4)]).unwrap();
    // Now 8 long; delete what was 2..3 and 6..7 (current 2..3 and 4..5) in one go.
    p.compose(&[del(2, 4, 2), del(4, 6, 2)]).unwrap();
    assert_eq!(p.deleted, vec![(2, 7)]);
    assert_eq!(p.len_b, 4);
}

#[test]
fn a_single_transaction_past_the_cap_becomes_a_whole_cap_overflow_barrier() {
    let k = PROVENANCE_CAP as i64;
    let mut p = Provenance::new(2 * k, PROVENANCE_CAP).unwrap();
    p.compose(&every_other_deleted(k)).unwrap();
    assert_eq!(
        p.whole.as_ref().map(|b| b.reason),
        Some(BreakReason::CapOverflow)
    );
    assert_eq!(p.len_b, k);
    assert_eq!(p.transactions, 1);
    assert!(p.entries() <= 4);
}

#[test]
fn a_transaction_past_the_cap_costs_little_more_than_reading_it() {
    // Validating the sections is the floor any compose pays; past the cap,
    // the effects and maps stop growing within a few sections of it.
    let k = 400_000;
    let changes = every_other_deleted(k);
    let floor = fastest(|| {
        validate_changes(&changes, 2 * k).unwrap();
    });
    let capped = fastest(|| {
        let mut p = Provenance::new(2 * k, 4).unwrap();
        p.compose(&changes).unwrap();
        assert_eq!(p.transactions, 1);
    });
    assert!(
        capped < floor * 4,
        "a capped compose took {capped:?}, validating the sections {floor:?}"
    );
}

#[test]
fn composing_the_map_stops_once_it_passes_the_limit() {
    let identity = [Piece {
        a: 0,
        b: 20,
        s: 1,
        o: 0,
    }];
    let changes = validate_changes(&every_other_deleted(10), 20).unwrap();
    let full = compose_pieces(&identity, &changes, -1, usize::MAX).unwrap();
    assert_eq!(
        compose_pieces(&identity, &changes, -1, full.len()),
        Some(full.clone())
    );
    assert_eq!(
        compose_pieces(&identity, &changes, -1, full.len() - 1),
        None
    );
    assert_eq!(compose_pieces(&identity, &[], -1, 0), None);
}

// An inverted normal span (`from > to`) covers the original gaps between its
// ends; a bounded break that meets that hull blocks it, as it would the span
// written the other way round.
#[test]
fn an_inverted_span_meeting_a_gap_break_is_blocked() {
    let mut p = Provenance::new(5, PROVENANCE_CAP).unwrap();
    p.break_gaps(0, 1, BreakReason::UncertifiedRange, "gaps")
        .unwrap();
    assert!(p.map_span(3, 0, false).unwrap().block.is_some());
    assert!(p.map_span(0, 3, false).unwrap().block.is_some());
    assert!(p.map_span(5, 3, false).unwrap().block.is_none());
}

#[test]
fn an_inverted_span_meeting_a_range_break_is_blocked() {
    let mut p = Provenance::new(10, PROVENANCE_CAP).unwrap();
    p.break_range(2, 4, 1, BreakReason::UncertifiedRange, "range")
        .unwrap();
    for (from, to) in [(5, 3), (3, 0), (4, 2)] {
        let m = p.map_span(from, to, false).unwrap();
        assert!(m.block.is_some(), "({from}, {to}) crosses the break");
    }
    assert!(p.map_span(9, 6, false).unwrap().block.is_none());
}
