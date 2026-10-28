//! `$$` math blocks the production parser keeps.
//!
//! The parser escapes a `$$` opener that does not close before a blank line
//! followed by more content (a blank-only tail is fine), unless nothing but
//! empty lines follow it; an escaped opener is paragraph text. Validity is
//! precomputed for every line in one backward pass, so asking is O(1).
//!
//! @module agent_journal/comment_anchor/math

use super::lines::{is_blank, up_to_three_spaces, Line};
use super::work;

fn dollar_run(s: &str) -> Option<(usize, &str)> {
    let r = up_to_three_spaces(s)?;
    let n = r.bytes().take_while(|b| *b == b'$').count();
    Some((n, &r[n..]))
}

/// A `$$` math opener's run length; its meta may not contain `$`.
pub(super) fn math_open(s: &str) -> Option<usize> {
    dollar_run(s)
        .filter(|(n, rest)| *n >= 2 && !rest.contains('$'))
        .map(|(n, _)| n)
}

/// A math closer's run length: a `$` run alone on its line.
pub(super) fn math_close(s: &str) -> Option<usize> {
    dollar_run(s)
        .filter(|(n, rest)| *n >= 1 && is_blank(rest))
        .map(|(n, _)| n)
}

/// Which lines open a `$$` math block the production parser keeps, and where it closes.
pub(super) struct MathIndex {
    open: Vec<usize>,
    close: Vec<usize>,
    /// The longest closer run within reach of line `j`: up to and including
    /// the first non-blank line after the first blank line following `j`.
    reach: Vec<usize>,
    /// Every line after `j` is empty.
    empty_tail: Vec<bool>,
}

impl MathIndex {
    pub fn new(lines: &[Line<'_>]) -> Self {
        let n = lines.len();
        work::add(n);
        let open: Vec<usize> = lines
            .iter()
            .map(|l| math_open(l.text).unwrap_or(0))
            .collect();
        let close: Vec<usize> = lines
            .iter()
            .map(|l| math_close(l.text).unwrap_or(0))
            .collect();
        let (mut reach, mut empty_tail) = (vec![0; n], vec![true; n]);
        let mut next_non_blank = None;
        for j in (0..n).rev() {
            if j + 1 < n {
                let below = j + 1;
                empty_tail[j] = lines[below].text.is_empty() && empty_tail[below];
                reach[j] = if is_blank(lines[below].text) {
                    next_non_blank.map_or(0, |k: usize| close[k])
                } else {
                    close[below].max(reach[below])
                };
            }
            if !is_blank(lines[j].text) {
                next_non_blank = Some(j);
            }
        }
        Self {
            open,
            close,
            reach,
            empty_tail,
        }
    }

    pub fn is_opener(&self, j: usize) -> bool {
        let run = self.open[j];
        run >= 2 && (self.reach[j] >= run || self.empty_tail[j])
    }

    /// The closing line of the math block opened at `j`; `None` when it runs to the end.
    pub fn closer(&self, j: usize) -> Option<usize> {
        let run = self.open[j];
        if self.reach[j] < run {
            return None;
        }
        (j + 1..self.close.len()).find(|&k| self.close[k] >= run)
    }
}
