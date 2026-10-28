//! Closed integer interval sets `[[lo, hi], …]`, sorted, touching intervals
//! merged (`next.lo > hi + 1`), so the representation is canonical.

pub type Interval = (i64, i64);

/// `set ∪ added`, built in one sweep as the ranges arrive in nondecreasing
/// `lo` order, so a transaction's effects merge in time linear in its
/// ranges and a capped caller can stop as soon as the result grows too large.
/// Merging ranges one at a time instead shifts the tail of `set` once per range.
pub struct SortedUnion<'a> {
    set: &'a [Interval],
    next: usize,
    out: Vec<Interval>,
    last_lo: i64,
}

impl<'a> SortedUnion<'a> {
    pub fn new(set: &'a [Interval]) -> Self {
        Self {
            set,
            next: 0,
            out: Vec::with_capacity(set.len()),
            last_lo: i64::MIN,
        }
    }

    /// Intervals in the result so far (never more than the finished set holds).
    pub fn len(&self) -> usize {
        self.out.len()
    }

    /// Adds `[lo, hi]` (skipped when empty); refuses an `lo` that goes backwards.
    pub fn add(&mut self, lo: i64, hi: i64) -> Result<(), String> {
        if lo > hi {
            return Ok(());
        }
        if lo < self.last_lo {
            return Err(format!(
                "interval additions out of order: {lo} after {}",
                self.last_lo
            ));
        }
        self.last_lo = lo;
        let set = self.set;
        while let Some(&iv) = set.get(self.next).filter(|iv| iv.0 <= lo) {
            self.take(iv);
            self.next += 1;
        }
        self.take((lo, hi));
        Ok(())
    }

    pub fn finish(mut self) -> Vec<Interval> {
        let set = self.set;
        for &iv in &set[self.next..] {
            self.take(iv);
        }
        self.out
    }

    fn take(&mut self, (lo, hi): Interval) {
        match self.out.last_mut() {
            Some(last) if lo <= last.1 + 1 => last.1 = last.1.max(hi),
            _ => self.out.push((lo, hi)),
        }
    }
}

/// Whether the set meets `[lo, hi]` (false for an empty range).
pub fn intersects(set: &[Interval], lo: i64, hi: i64) -> bool {
    if lo > hi {
        return false;
    }
    let a = set.partition_point(|iv| iv.1 < lo);
    a < set.len() && set[a].0 <= hi
}

/// Fails unless `set` is a canonical interval set within `[min, max]`.
pub fn validate_intervals(
    set: &[(u64, u64)],
    min: i64,
    max: i64,
    what: &str,
) -> Result<Vec<Interval>, String> {
    let mut prev = i64::MIN;
    let mut out = Vec::with_capacity(set.len());
    for &(a, b) in set {
        let (a, b) = (
            i64::try_from(a).unwrap_or(i64::MAX),
            i64::try_from(b).unwrap_or(i64::MAX),
        );
        let disjoint = prev == i64::MIN || a > prev + 1;
        if !(a <= b && a >= min && b <= max && disjoint) {
            return Err(format!("malformed {what}: [{a}, {b}]"));
        }
        prev = b;
        out.push((a, b));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "intervals.test.rs"]
mod tests;
