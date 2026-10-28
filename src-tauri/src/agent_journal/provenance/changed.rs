//! The changed runs of a certified map: each maximal stretch where the
//! original text and the mapped text differ, read off the map in one pass
//! over the original characters. A selection edit's hunks are derived from
//! these, never sent by the window.

use super::accumulator::Provenance;
use super::pieces::{piece_at, value_of};
use super::Block;

/// One changed run: original units `[a.0, a.1)` became mapped units
/// `[b.0, b.1)`. Either side may be empty, never both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangedRun {
    pub a: (i64, i64),
    pub b: (i64, i64),
}

impl Provenance {
    /// The whole-document break, if the window holds one.
    pub fn whole_block(&self) -> Option<&Block> {
        self.whole.as_ref()
    }

    /// Every changed run, in order. A surviving original character `i` sits
    /// at `R(i)`; anything between two survivors, or before the first or
    /// after the last, is changed. O(len_a + pieces).
    pub fn changed_runs(&self) -> Vec<ChangedRun> {
        let mut runs = Vec::new();
        let (mut di, mut ri) = (0, piece_at(&self.rp, 0));
        // The first original and mapped units after the last survivor.
        let (mut pa, mut pb) = (0, 0);
        for i in 0..self.len_a {
            while di < self.deleted.len() && self.deleted[di].1 < i {
                di += 1;
            }
            if self.deleted.get(di).is_some_and(|d| d.0 <= i) {
                continue;
            }
            while self.rp[ri].b < i {
                ri += 1;
            }
            let at = value_of(&self.rp[ri], i);
            if i > pa || at > pb {
                runs.push(ChangedRun {
                    a: (pa, i),
                    b: (pb, at),
                });
            }
            (pa, pb) = (i + 1, at + 1);
        }
        if pa < self.len_a || pb < self.len_b {
            runs.push(ChangedRun {
                a: (pa, self.len_a),
                b: (pb, self.len_b),
            });
        }
        runs
    }
}

#[cfg(test)]
#[path = "changed.test.rs"]
mod tests;
