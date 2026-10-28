//! The accumulator of one capture window:
//! `L(p)` is original gap `p` mapped through every transaction in order with
//! `assoc = −1`, `R(p)` the same with `assoc = +1`. Alongside the map it
//! keeps the effects (original characters deleted, original gaps touched)
//! and the breaks. Breaks are sticky: nothing clears them.

use super::intervals::{intersects, Interval};
use super::pieces::{evaluate, lower_p, validate_changes, Piece, Section};
use super::{Block, BreakReason, MAX_SAFE, MIN_PROVENANCE_CAP, PROVENANCE_CAP};

/// A bounded break: original-gap thresholds `(fromMax, toMin)` per span kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bounded {
    pub normal: (i64, i64),
    pub growing: (i64, i64),
    pub block: Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provenance {
    pub(super) len_a: i64,
    pub(super) len_b: i64,
    pub(super) cap: u64,
    pub(super) lp: Vec<Piece>,
    pub(super) rp: Vec<Piece>,
    pub(super) deleted: Vec<Interval>,
    pub(super) touched: Vec<Interval>,
    pub(super) whole: Option<Block>,
    pub(super) bounded: Vec<Bounded>,
    pub(super) transactions: i64,
}

/// What one window says about a span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpanMapping {
    pub from: i64,
    pub to: i64,
    pub growing: bool,
    /// The span's own text or interior was edited.
    pub hit: bool,
    /// `hit`, or (anchors) a neighbour character was replaced.
    pub edited: bool,
    /// The break that makes the span's mapping unknown.
    pub block: Option<Block>,
}

#[path = "accumulator_compose.rs"]
mod compose;

fn check_len(n: i64) -> Result<i64, String> {
    if (0..=MAX_SAFE).contains(&n) {
        Ok(n)
    } else {
        Err(format!("malformed length {n}"))
    }
}

impl Provenance {
    pub fn new(len_a: i64, cap: u64) -> Result<Self, String> {
        check_len(len_a)?;
        if !(MIN_PROVENANCE_CAP..=PROVENANCE_CAP).contains(&cap) {
            return Err(format!("malformed cap {cap}"));
        }
        let identity = vec![Piece {
            a: 0,
            b: len_a,
            s: 1,
            o: 0,
        }];
        Ok(Self {
            len_a,
            len_b: len_a,
            cap,
            lp: identity.clone(),
            rp: identity,
            deleted: vec![],
            touched: vec![],
            whole: None,
            bounded: vec![],
            transactions: 0,
        })
    }

    pub fn len_b(&self) -> i64 {
        self.len_b
    }

    pub fn cap(&self) -> u64 {
        self.cap
    }

    /// In-memory entries: L and R pieces, effect intervals, bounded breaks.
    pub fn entries(&self) -> usize {
        self.lp.len() + self.rp.len() + self.deleted.len() + self.touched.len() + self.bounded.len()
    }

    fn gap(&self, p: i64) -> Result<i64, String> {
        if (0..=self.len_a).contains(&p) {
            Ok(p)
        } else {
            Err(format!("gap {p} outside [0, {}]", self.len_a))
        }
    }

    pub fn l(&self, p: i64) -> Result<i64, String> {
        Ok(evaluate(&self.lp, self.gap(p)?))
    }

    pub fn r(&self, p: i64) -> Result<i64, String> {
        Ok(evaluate(&self.rp, self.gap(p)?))
    }

    /// Smallest original gap whose L (`left`) or R value is `> x` (strict) or `>= x`; `len_a + 1` when none.
    fn first(&self, left: bool, x: i64, strict: bool) -> i64 {
        lower_p(
            if left { &self.lp } else { &self.rp },
            self.len_a,
            x,
            strict,
        )
    }

    /// An uncertified replacement of `[x0, x1)` by `ins_len` characters: a sticky bounded barrier.
    pub fn break_range(
        &mut self,
        x0: i64,
        x1: i64,
        ins_len: i64,
        reason: BreakReason,
        origin: &str,
    ) -> Result<&mut Self, String> {
        if reason.is_whole() {
            return Err(format!("a bounded break cannot be {reason:?}"));
        }
        let block = Block::new(reason, origin)?;
        if !(0 <= x0 && x0 <= x1 && x1 <= self.len_b && (0..=MAX_SAFE).contains(&ins_len)) {
            return Err(format!(
                "malformed break range [{x0}, {x1}, {ins_len}] (length {})",
                self.len_b
            ));
        }
        let section = Section {
            from_a: x0,
            to_a: x1,
            from_b: x0,
            to_b: x0 + ins_len,
        };
        // Refused before the sticky break is recorded, so a failure changes nothing.
        validate_changes(&[section], self.len_b)?;
        if self.whole.is_none() {
            // A span is reached iff the positions it maps to meet [x0, x1]: as original-gap thresholds.
            self.bounded.push(Bounded {
                normal: (self.first(false, x1, true) - 1, self.first(true, x0, false)),
                growing: (self.first(true, x1, true) - 1, self.first(false, x0, false)),
                block,
            });
        }
        self.compose(&[section])
    }

    /// A bounded break over original gaps `[g0, g1]` that maps nothing:
    /// it blocks every span whose original gaps meet the region.
    pub fn break_gaps(
        &mut self,
        g0: i64,
        g1: i64,
        reason: BreakReason,
        origin: &str,
    ) -> Result<&mut Self, String> {
        if reason.is_whole() {
            return Err(format!("a bounded break cannot be {reason:?}"));
        }
        let block = Block::new(reason, origin)?;
        if !(0 <= g0 && g0 <= g1 && g1 <= self.len_a) {
            return Err(format!(
                "malformed gap region [{g0}, {g1}] (length {})",
                self.len_a
            ));
        }
        if self.whole.is_none() {
            self.bounded.push(Bounded {
                normal: (g1, g0),
                growing: (g1, g0),
                block,
            });
        }
        Ok(self)
    }

    /// The whole document was replaced with no certified mapping; the first reason is kept.
    pub fn break_whole(
        &mut self,
        len_b: i64,
        reason: BreakReason,
        origin: &str,
    ) -> Result<&mut Self, String> {
        if !reason.is_whole() {
            return Err(format!("a whole break cannot be {reason:?}"));
        }
        let block = Block::new(reason, origin)?;
        check_len(len_b)?;
        self.whole_break(len_b, block);
        self.transactions += 1;
        Ok(self)
    }

    fn whole_break(&mut self, len_b: i64, block: Block) {
        if self.whole.is_none() {
            self.whole = Some(block);
        }
        self.lp = vec![Piece {
            a: 0,
            b: self.len_a,
            s: 0,
            o: 0,
        }];
        self.rp = vec![Piece {
            a: 0,
            b: self.len_a,
            s: 0,
            o: len_b,
        }];
        self.deleted = if self.len_a > 0 {
            vec![(0, self.len_a - 1)]
        } else {
            vec![]
        };
        self.touched = vec![(0, self.len_a)];
        self.bounded.clear();
        self.len_b = len_b;
    }

    /// Maps a hunk span of the window's original text. A normal span keeps
    /// edge insertions outside (from with R, to with L); a growing span
    /// (deletion anchor) absorbs them (from with L, to with R).
    pub fn map_span(&self, from: i64, to: i64, growing: bool) -> Result<SpanMapping, String> {
        self.gap(from)?;
        self.gap(to)?;
        let (lo, hi) = (from.min(to), from.max(to));
        let (d, t) = (&self.deleted, &self.touched);
        let (mf, mt) = if growing {
            (self.l(from)?, self.r(to)?)
        } else {
            (self.r(from)?, self.l(to)?)
        };
        let hit = if growing {
            intersects(t, lo, hi) || intersects(d, lo, hi - 1)
        } else {
            intersects(d, lo, hi - 1) || intersects(t, lo + 1, hi - 1)
        };
        let edited = hit
            || if growing {
                intersects(d, lo - 1, hi)
            } else {
                from >= to && intersects(t, lo, hi)
            };
        // An inverted span covers the gaps `[lo, hi]`, which map onto
        // `[L(lo), R(hi)]`: the growing span's hull, so its thresholds.
        let reaches = |x: &&Bounded| {
            let (from_max, to_min) = if growing || from > to {
                x.growing
            } else {
                x.normal
            };
            lo <= from_max && hi >= to_min
        };
        let block = self
            .whole
            .clone()
            .or_else(|| self.bounded.iter().find(reaches).map(|x| x.block.clone()));
        Ok(SpanMapping {
            from: mf,
            to: mt,
            growing,
            hit,
            edited,
            block,
        })
    }
}
