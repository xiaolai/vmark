//! Composing one certified transaction into the accumulator. A replace-all
//! of thousands of ranges streams its effects into the sets in one sweep,
//! and nothing grows past the cap before it stops: a transaction that would
//! pass it lands as the whole `CapOverflow` break, built from the cap's
//! worth of work rather than the whole transaction.

use super::super::intervals::{Interval, SortedUnion};
use super::super::pieces::{compose_pieces, validate_changes, Piece, Section};
use super::super::{Block, BreakReason};
use super::Provenance;

/// The maps and effect sets after a transaction: `(L, R, deleted, touched)`.
type Composed = (Vec<Piece>, Vec<Piece>, Vec<Interval>, Vec<Interval>);

impl Provenance {
    /// Composes one certified transaction, given as CodeMirror sections.
    pub fn compose(&mut self, changes: &[Section]) -> Result<&mut Self, String> {
        let sections = validate_changes(changes, self.len_b)?;
        let len_b = self.len_b + sections.last().map_or(0, |l| l.to_b - l.to_a);
        let next = self.composed(&sections)?;
        self.transactions += 1;
        match next {
            Some((lp, rp, deleted, touched)) => {
                (self.lp, self.rp, self.deleted, self.touched) = (lp, rp, deleted, touched);
                self.len_b = len_b;
            }
            None => self.whole_break(
                len_b,
                Block {
                    reason: BreakReason::CapOverflow,
                    origin: "accumulator".into(),
                },
            ),
        }
        Ok(self)
    }

    /// The window after `sections`, or `None` as soon as its entries pass the cap.
    fn composed(&self, sections: &[Section]) -> Result<Option<Composed>, String> {
        let cap = usize::try_from(self.cap).unwrap_or(usize::MAX);
        let mut chars = SortedUnion::new(&self.deleted);
        let mut gaps = SortedUnion::new(&self.touched);
        for c in sections {
            self.effects(c, &mut chars, &mut gaps)?;
            if chars.len() + gaps.len() + self.bounded.len() > cap {
                return Ok(None);
            }
        }
        let (deleted, touched) = (chars.finish(), gaps.finish());
        let Some(room) = cap.checked_sub(deleted.len() + touched.len() + self.bounded.len()) else {
            return Ok(None);
        };
        let Some(lp) = compose_pieces(&self.lp, sections, -1, room) else {
            return Ok(None);
        };
        let rp = compose_pieces(&self.rp, sections, 1, room - lp.len());
        Ok(rp.map(|rp| (lp, rp, deleted, touched)))
    }

    /// Adds one section's effects, read through the maps as they were before
    /// the transaction. Sections come sorted and `lower_p` is monotone, so
    /// both streams arrive in nondecreasing `lo` order.
    fn effects(
        &self,
        c: &Section,
        chars: &mut SortedUnion,
        gaps: &mut SortedUnion,
    ) -> Result<(), String> {
        let (x0, x1) = (c.from_a, c.to_a);
        if x1 > x0 {
            if let Some((lo, hi)) = self.chars_in(x0, x1) {
                chars.add(lo, hi)?;
            }
            gaps.add(self.first(false, x0, true), self.first(true, x1, false) - 1)
        } else {
            gaps.add(self.first(false, x0, false), self.first(true, x0, true) - 1)
        }
    }

    /// Original characters still alive in `[x0, x1)` of the current text, plus dead ones inside it.
    fn chars_in(&self, x0: i64, x1: i64) -> Option<(i64, i64)> {
        let lo = (self.first(true, x0, true) - 1).max(0);
        let hi = (self.first(false, x1, false) - 1).min(self.len_a - 1);
        (lo <= hi).then_some((lo, hi))
    }
}
