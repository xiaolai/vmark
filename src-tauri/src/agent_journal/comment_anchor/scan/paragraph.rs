//! Paragraph text at the root: the link reference definitions it opens
//! with, the paragraph itself, a setext heading or a table it forms.
//!
//! @module agent_journal/comment_anchor/scan/paragraph

use super::super::definition::definition_end;
use super::super::html::{delimiter_cells, table_cells};
use super::super::lines::{is_blank, lead, setext_underline, unindented};
use super::{Kind, Scanner};

impl Scanner<'_> {
    /// The link reference definitions opening the paragraph text at line
    /// `first`, each its own block, then whatever paragraph follows them;
    /// `None` when the text opens with no definition. The text runs to a
    /// blank line, an interrupting line or a setext underline (which a
    /// definition's title never crosses).
    pub(super) fn definitions(&mut self, first: usize) -> Option<usize> {
        if !unindented(self.text(first)).is_some_and(|r| r.starts_with('[')) {
            return None;
        }
        let mut end = first + 1;
        while end < self.lines.len() {
            let t = self.text(end);
            if is_blank(t) || self.interrupts(end, false) || self.underline(t).is_some() {
                break;
            }
            end += 1;
        }
        let mut joined = String::new();
        let mut starts = Vec::with_capacity(end - first);
        for j in first..end {
            if j > first {
                joined.push('\n');
            }
            starts.push(joined.len());
            joined.push_str(self.text(j));
        }
        let mut next = first;
        let mut at = 0;
        while at < joined.len() {
            let Some(stop) = definition_end(&joined[at..]).map(|n| at + n) else {
                break;
            };
            let last = first + starts.partition_point(|&s| s <= stop) - 1;
            self.other(next, last);
            next = last + 1;
            at = stop + 1;
        }
        if next == first {
            None
        } else if next < end {
            Some(self.paragraph_at(next, first))
        } else {
            Some(next)
        }
    }

    /// A setext underline's depth, when setext headings are read.
    fn underline(&self, t: &str) -> Option<u8> {
        setext_underline(t).filter(|_| self.setext)
    }

    pub(in super::super) fn paragraph(&mut self, first: usize) -> usize {
        self.paragraph_at(first, first)
    }

    /// The paragraph whose text starts at line `first`; a setext heading it
    /// forms starts at line `head`, where any definitions before it start.
    fn paragraph_at(&mut self, first: usize, head: usize) -> usize {
        let mut last = first;
        let mut j = first + 1;
        while j < self.lines.len() {
            let t = self.text(j);
            if is_blank(t) {
                break;
            }
            if let Some(depth) = self.underline(t) {
                let line = self.lines[head].start;
                let text_end =
                    self.lines[last].start + self.text(last).trim_end_matches([' ', '\t']).len();
                let kind = Kind::Heading {
                    depth,
                    line,
                    text: (self.first_char(first), text_end),
                };
                self.push(self.first_char(head), self.lines[j].end(), kind);
                return j + 1;
            }
            if delimiter_cells(t).is_some_and(|n| n == table_cells(self.text(last))) {
                if last > first {
                    self.other(first, last - 1);
                }
                return self.table(last, j);
            }
            if self.interrupts(j, false) {
                break;
            }
            last = j;
            j += 1;
        }
        self.other(first, last);
        j
    }

    fn table(&mut self, head: usize, delimiter: usize) -> usize {
        let mut last = delimiter;
        let mut j = delimiter + 1;
        while j < self.lines.len() {
            let t = self.text(j);
            if is_blank(t) || lead(t).0 >= 4 || self.interrupts(j, true) {
                break;
            }
            last = j;
            j += 1;
        }
        self.other(head, last);
        j
    }
}
