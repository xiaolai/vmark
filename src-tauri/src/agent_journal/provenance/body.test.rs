//! Decoding a persisted body fails closed: a break's reason must belong to
//! its class, and the rebuilt accumulator must fit the declared cap.

use super::super::{Block, BreakReason, Provenance, Section};
use super::Body;

/// One-character deletions at `at` (right to left, so each offset is the
/// original one), composed under the widest cap.
fn deletions(len_a: i64, at: &[i64]) -> Provenance {
    let mut p = Provenance::new(len_a, 64).expect("new");
    for &x in at.iter().rev() {
        p.compose(&[Section {
            from_a: x,
            to_a: x + 1,
            from_b: x,
            to_b: x,
        }])
        .expect("compose");
    }
    p
}

/// Encode, decode under `cap`, encode again.
fn round_trip(p: &Provenance, cap: u64) -> Body {
    Provenance::decode(&p.encode(), cap)
        .expect("decodes")
        .encode()
}

fn bounded(reason: BreakReason) -> Provenance {
    let mut p = Provenance::new(10, 64).expect("new");
    p.break_range(2, 4, 1, reason, "window:blocks")
        .expect("break");
    p
}

#[test]
fn a_bounded_break_decodes_only_as_an_uncertified_range() {
    let ok = bounded(BreakReason::UncertifiedRange);
    assert_eq!(round_trip(&ok, 64), ok.encode());
    for reason in [
        BreakReason::SnapshotOnly,
        BreakReason::WholeDocumentWrite,
        BreakReason::ExternalReload,
        BreakReason::Restore,
        BreakReason::CapOverflow,
        BreakReason::UnclosedEpoch,
        BreakReason::ParentMismatch,
    ] {
        let mut body = ok.encode();
        body.breaks.bounded[0].reason = reason;
        let err = Provenance::decode(&body, 64).expect_err("a whole-document reason");
        assert!(err.contains("bounded break"), "{reason:?}: {err}");
    }
}

#[test]
fn a_whole_break_never_decodes_as_an_uncertified_range() {
    let mut p = Provenance::new(10, 64).expect("new");
    p.break_whole(3, BreakReason::SnapshotOnly, "snapshot")
        .expect("break");
    assert_eq!(round_trip(&p, 64), p.encode());
    let mut body = p.encode();
    body.breaks.whole = Some(Block::new(BreakReason::UncertifiedRange, "x").unwrap());
    let err = Provenance::decode(&body, 64).expect_err("a bounded reason");
    assert!(err.contains("whole break"), "{err}");
}

/// The serialized bound (`2 × cap` canonical entries) and the per-side
/// piece bound both admit this body at `cap = 4`; the rebuilt accumulator
/// does not fit, so it is refused rather than kept without a `capOverflow`.
#[test]
fn a_body_rebuilding_more_entries_than_its_cap_is_refused() {
    let p = deletions(20, &[3, 9]);
    let body = p.encode();
    let cap = 4;
    assert!(
        body.canonical_entries() <= 2 * cap,
        "the serialized bound admits it"
    );
    assert!(p.entries() > cap);
    let err = Provenance::decode(&body, cap as u64).expect_err("over the cap");
    assert!(err.contains("cap"), "{err}");
    assert_eq!(round_trip(&p, p.entries() as u64), body, "at the cap");
}

/// The fewest constant or slope-one stretches covering `values`, by trying
/// every split: the decoder's rebuilt pieces must be that few, and hold
/// exactly `values`.
fn fewest_by_search(values: &[i64]) -> i64 {
    let fits = |seg: &[i64]| {
        let d: Vec<i64> = seg.windows(2).map(|w| w[1] - w[0]).collect();
        d.iter().all(|x| *x == 0) || d.iter().all(|x| *x == 1)
    };
    let mut best = vec![i64::MAX; values.len() + 1];
    best[0] = 0;
    for end in 1..=values.len() {
        for start in 0..end {
            if best[start] != i64::MAX && fits(&values[start..end]) {
                best[end] = best[end].min(best[start] + 1);
            }
        }
    }
    best[values.len()]
}

#[test]
fn the_rebuilt_pieces_are_the_fewest_an_exhaustive_search_finds() {
    use super::super::pieces::evaluate;
    use super::super::runs::pieces_from_runs;
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    for _ in 0..4000 {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let len = (seed >> 60) as usize; // 0..=15 positions after gap 0
        let mut values = vec![0_i64];
        // Runs as the zipped body may hold them: a run may repeat its neighbour's delta.
        let mut runs: Vec<(i64, i64)> = Vec::new();
        for i in 0..len {
            let delta = [0, 1, 1, 0, 2, 5][((seed >> (i * 3 % 57)) % 6) as usize];
            values.push(values.last().unwrap() + delta);
            match runs.last_mut() {
                Some(r) if r.1 == delta && (seed >> i) & 1 == 0 => r.0 += 1,
                _ => runs.push((1, delta)),
            }
        }
        let pieces = pieces_from_runs(0, &runs, len as i64, 64).expect("rebuilds");
        assert_eq!(
            pieces.len() as i64,
            fewest_by_search(&values),
            "runs {runs:?}"
        );
        for (g, v) in values.iter().enumerate() {
            assert_eq!(evaluate(&pieces, g as i64), *v, "runs {runs:?} gap {g}");
        }
    }
}

/// A small seeded generator: `next(m)` is in `0..m`.
fn rng(mut seed: u64) -> impl FnMut(i64) -> i64 {
    move |m: i64| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) % (m.max(1) as u64)) as i64
    }
}

/// `abc → c` (delete `ab`): the decoder rebuilds the fewest pieces, so the
/// accumulator it returns holds no more entries than the cap it was
/// admitted under, and no more than the accumulator that wrote it.
#[test]
fn a_decoded_accumulator_holds_no_more_entries_than_its_cap() {
    let mut p = Provenance::new(3, 64).expect("new");
    p.compose(&[Section {
        from_a: 0,
        to_a: 2,
        from_b: 0,
        to_b: 0,
    }])
    .expect("compose");
    for cap in 4..=8 {
        if let Ok(d) = Provenance::decode(&p.encode(), cap) {
            assert!(
                d.entries() as u64 <= cap,
                "cap {cap}: {} entries",
                d.entries()
            );
        }
    }
}

/// Random multi-transaction windows: decoding under the writer's own entry
/// count succeeds, rebuilds at most that many entries, and maps every gap
/// exactly as the writer did.
#[test]
fn decoding_never_grows_an_accumulator_and_keeps_its_map() {
    let mut next = rng(12345);
    for _ in 0..5000 {
        let mut p = Provenance::new(next(12), 64).expect("new");
        for _ in 0..next(6) {
            let lb = p.len_b();
            let x0 = next(lb + 1);
            let x1 = x0 + next(lb - x0 + 1);
            let ins = next(3);
            p.compose(&[Section {
                from_a: x0,
                to_a: x1,
                from_b: x0,
                to_b: x0 + ins,
            }])
            .expect("compose");
        }
        let cap = (p.entries() as u64).max(4);
        let d = Provenance::decode(&p.encode(), cap).expect("an honest body decodes");
        assert!(d.entries() <= p.entries().max(4), "{:?} → {:?}", p.lp, d.lp);
        for g in 0..=p.len_a {
            assert_eq!((d.l(g), d.r(g)), (p.l(g), p.r(g)), "gap {g}");
        }
        assert_eq!(d.encode(), p.encode());
    }
}

/// Every break reason of the other class, for the builders.
const WHOLE_REASONS: [BreakReason; 7] = [
    BreakReason::SnapshotOnly,
    BreakReason::WholeDocumentWrite,
    BreakReason::ExternalReload,
    BreakReason::Restore,
    BreakReason::CapOverflow,
    BreakReason::UnclosedEpoch,
    BreakReason::ParentMismatch,
];

/// The builders hold the decoder's reason classes, so nothing they build
/// fails to decode: a bounded break is only an `uncertifiedRange`, a whole
/// break never is, and a refused break changes nothing.
#[test]
fn the_break_builders_refuse_a_reason_of_the_other_class() {
    for reason in WHOLE_REASONS {
        let mut p = Provenance::new(10, 64).expect("new");
        let before = p.encode();
        let err = p
            .break_range(2, 4, 1, reason, "window:blocks")
            .map(|_| ())
            .expect_err("a whole-document reason");
        assert!(err.contains("bounded break"), "{reason:?}: {err}");
        assert_eq!(p.encode(), before, "{reason:?}: unchanged");
        p.break_whole(3, reason, "snapshot")
            .expect("a whole reason");
        assert_eq!(round_trip(&p, 64), p.encode(), "{reason:?}");
    }
    let mut p = Provenance::new(10, 64).expect("new");
    let before = p.encode();
    let err = p
        .break_whole(3, BreakReason::UncertifiedRange, "x")
        .map(|_| ())
        .expect_err("a bounded reason");
    assert!(err.contains("whole break"), "{err}");
    assert_eq!(p.encode(), before, "unchanged");
}
