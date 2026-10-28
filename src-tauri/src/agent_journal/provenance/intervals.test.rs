//! Interval sets: a transaction's effects merge into the sets in one pass,
//! so a replace-all costs time linear in its ranges, with the same result
//! as adding each range alone.

use super::{Interval, SortedUnion};

/// `set ∪ added` through the streaming union, `added` sorted first as a
/// caller's ranges arrive.
fn union_intervals(set: &[Interval], mut added: Vec<Interval>) -> Vec<Interval> {
    added.sort_unstable();
    let mut union = SortedUnion::new(set);
    for (lo, hi) in added {
        union.add(lo, hi).expect("sorted additions");
    }
    union.finish()
}

/// CPU time of this thread, in nanoseconds (not wall time, so other test
/// threads never count).
#[cfg(unix)] // `libc` is a Unix-only dependency
fn thread_cpu_ns() -> u128 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid out-pointer for the duration of the call.
    let rc = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    assert_eq!(rc, 0, "clock_gettime");
    t.tv_sec as u128 * 1_000_000_000 + t.tv_nsec as u128
}

/// `n` single-point ranges `start, start + 2, …`, none touching.
#[cfg(unix)]
fn spaced(start: i64, n: i64) -> Vec<Interval> {
    (0..n).map(|i| (start + 2 * i, start + 2 * i)).collect()
}

/// CPU nanoseconds of merging a replace-all's `k` ranges into a set of `m`
/// ranges lying all after them (`after`) or all before them.
#[cfg(unix)]
fn merge(m: i64, k: i64, after: bool) -> u128 {
    let (set, added) = if after {
        (spaced(2 * k, m), spaced(0, k))
    } else {
        (spaced(0, m), spaced(2 * m, k))
    };
    let t = thread_cpu_ns();
    let out = union_intervals(&set, added);
    let spent = thread_cpu_ns() - t;
    assert_eq!(out.len() as i64, m + k);
    spent
}

/// Adding a replace-all's ranges one at a time shifts every existing range
/// after them once per new range (`k × m` moves, about x30 here); one
/// merge per transaction costs the same wherever the existing ranges lie.
#[cfg(unix)]
#[test]
fn a_replace_all_merges_as_fast_before_existing_ranges_as_after_them() {
    let (m, k) = (20_000, 20_000);
    let (mut before, mut after) = (u128::MAX, u128::MAX);
    for _ in 0..5 {
        before = before.min(merge(m, k, false));
        after = after.min(merge(m, k, true));
    }
    let ratio = after as f64 / before.max(1) as f64;
    assert!(
        ratio < 4.0,
        "{after} ns with {m} ranges after the replace-all, {before} ns with them before: x{ratio:.1}"
    );
}

/// The canonical set covering exactly the points of `ranges` within `0..n`.
fn by_points(n: i64, ranges: &[Interval]) -> Vec<Interval> {
    let hit = |x: i64| ranges.iter().any(|&(lo, hi)| lo <= x && x <= hi);
    let mut out: Vec<Interval> = vec![];
    for x in (0..n).filter(|&x| hit(x)) {
        match out.last_mut() {
            Some(last) if last.1 + 1 == x => last.1 = x,
            _ => out.push((x, x)),
        }
    }
    out
}

/// Every pair of a canonical set and a batch (unsorted, overlapping,
/// touching, empty ranges) over a small universe merges to the point union.
#[test]
fn a_batch_merge_is_the_union_of_its_points() {
    let ranges: Vec<Interval> = (0..6)
        .flat_map(|lo| (lo - 1..6).map(move |hi| (lo, hi)))
        .collect();
    let mut seed = 0x9e37_79b9_u64;
    let mut pick = |len: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % len as u64) as usize
    };
    for _ in 0..20_000 {
        let base: Vec<Interval> = (0..pick(4)).map(|_| ranges[pick(ranges.len())]).collect();
        let set = by_points(6, &base);
        let added: Vec<Interval> = (0..pick(5)).map(|_| ranges[pick(ranges.len())]).collect();
        let all: Vec<Interval> = set.iter().chain(&added).copied().collect();
        assert_eq!(
            union_intervals(&set, added.clone()),
            by_points(6, &all),
            "{set:?} with {added:?}"
        );
    }
}

#[test]
fn a_range_arriving_out_of_order_is_refused() {
    let set = [(0, 1)];
    let mut union = SortedUnion::new(&set);
    union.add(5, 6).unwrap();
    union.add(4, 3).unwrap(); // empty: skipped, order not checked
    assert!(union.add(4, 9).unwrap_err().contains("out of order"));
}
