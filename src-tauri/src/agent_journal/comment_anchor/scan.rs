//! The root-level block scanner behind the outline: which lines form which
//! top-level block, and which of those blocks are headings.
//!
//! Key decisions:
//!   - Only the document's root is modelled exactly. Inside a list item or a
//!     block quote only what decides lazy continuation is tracked (`Inner`:
//!     an open paragraph, fence or HTML block), with nested container
//!     markers stripped; a heading-like line in there is never a root heading.
//!   - A `$$` math opener counts only when the production parser keeps it
//!     (see `math`). List items and block quotes are read in `container`.
//!   - Paragraph text (definitions, setext headings, tables) is read in
//!     `paragraph`.
//!   - The scan is linear: every block consumes its lines once, and math
//!     validity is precomputed (`MathIndex`).
//!
//! @module agent_journal/comment_anchor/scan

use super::html::{html_ends, html_start, HtmlEnd};
use super::lines::{
    atx, fence_close, fence_open, is_blank, lead, list_marker, quote_content, thematic, Line,
    ListKind,
};
use super::math::MathIndex;
use super::work;

mod paragraph;

/// What a root block is, as far as the outline cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    /// `line` is the heading's first line start; `text` its text's byte range.
    Heading {
        depth: u8,
        line: usize,
        text: (usize, usize),
    },
    Html,
    Other,
}

/// A root block's byte range and kind.
#[derive(Debug, Clone, Copy)]
pub(super) struct Block {
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
}

/// The root blocks of `lines` from line `from`; `setext` is whether setext headings are read.
pub(super) fn scan(text_len: usize, lines: &[Line<'_>], from: usize, setext: bool) -> Vec<Block> {
    let mut s = Scanner {
        text_len,
        lines,
        math: MathIndex::new(lines),
        setext,
        out: Vec::new(),
    };
    let mut i = from;
    while i < lines.len() {
        i = s.block(i);
    }
    s.out
}

pub(super) struct Scanner<'a> {
    text_len: usize,
    pub(super) lines: &'a [Line<'a>],
    math: MathIndex,
    setext: bool,
    out: Vec<Block>,
}

impl Scanner<'_> {
    /// Line `i`'s text; every line read is counted.
    pub(super) fn text(&self, i: usize) -> &str {
        work::add(1);
        self.lines[i].text
    }

    fn first_char(&self, i: usize) -> usize {
        self.lines[i].start + lead(self.text(i)).1
    }

    fn push(&mut self, start: usize, end: usize, kind: Kind) {
        self.out.push(Block { start, end, kind });
    }

    pub(super) fn other(&mut self, first: usize, last: usize) {
        let (start, end) = (self.first_char(first), self.lines[last].end());
        self.push(start, end, Kind::Other);
    }

    /// Read the block starting at non-consumed line `i`; returns the next line to read.
    fn block(&mut self, i: usize) -> usize {
        let t = self.text(i);
        if is_blank(t) {
            return i + 1;
        }
        if lead(t).0 >= 4 {
            return self.indented_code(i);
        }
        if let Some((ch, run)) = fence_open(t) {
            return self.fence(i, ch, run);
        }
        if self.math.is_opener(i) {
            return self.math_block(i);
        }
        if let Some((depth, a, b)) = atx(t) {
            let (line, end) = (self.lines[i].start, self.lines[i].end());
            let kind = Kind::Heading {
                depth,
                line,
                text: (line + a, line + b),
            };
            self.push(self.first_char(i), end, kind);
            return i + 1;
        }
        if thematic(t) {
            self.other(i, i);
            return i + 1;
        }
        if list_marker(t).is_some() {
            return self.list(i);
        }
        if quote_content(t).is_some() {
            return self.quote(i);
        }
        if let Some(end) = html_start(t, false) {
            return self.html(i, end);
        }
        if let Some(next) = self.definitions(i) {
            return next;
        }
        self.paragraph(i)
    }

    /// Whether line `i` starts a block that ends an open paragraph. In a
    /// container's lazy continuation (`lazy`) any list item does; at the root
    /// only a non-empty bullet or an item numbered 1.
    pub(super) fn interrupts(&self, i: usize, lazy: bool) -> bool {
        let t = self.text(i);
        if lead(t).0 >= 4 {
            return false;
        }
        let list = list_marker(t).is_some_and(|m| {
            lazy || (!m.empty && (matches!(m.kind, ListKind::Bullet(_)) || m.value == 1))
        });
        list || fence_open(t).is_some()
            || self.math.is_opener(i)
            || atx(t).is_some()
            || thematic(t)
            || quote_content(t).is_some()
            || html_start(t, true).is_some()
    }

    fn indented_code(&mut self, first: usize) -> usize {
        let mut last = first;
        let mut j = first;
        while j < self.lines.len() && (is_blank(self.text(j)) || lead(self.text(j)).0 >= 4) {
            if !is_blank(self.text(j)) {
                last = j;
            }
            j += 1;
        }
        self.push(self.lines[first].start, self.lines[last].end(), Kind::Other);
        last + 1
    }

    fn fence(&mut self, first: usize, ch: char, run: usize) -> usize {
        let start = self.first_char(first);
        match (first + 1..self.lines.len()).find(|&j| fence_close(self.text(j), ch, run)) {
            Some(j) => {
                self.push(start, self.lines[j].end(), Kind::Other);
                j + 1
            }
            None => {
                // An unclosed fence runs to the end of the document.
                self.push(start, self.text_len, Kind::Other);
                self.lines.len()
            }
        }
    }

    fn math_block(&mut self, first: usize) -> usize {
        let start = self.first_char(first);
        match self.math.closer(first) {
            Some(j) => {
                self.push(start, self.lines[j].end(), Kind::Other);
                j + 1
            }
            None => {
                self.push(start, self.text_len, Kind::Other);
                self.lines.len()
            }
        }
    }

    fn html(&mut self, first: usize, end: HtmlEnd) -> usize {
        let start = self.lines[first].start;
        let n = self.lines.len();
        let last = match end {
            HtmlEnd::Marker(m) => match (first..n).find(|&j| html_ends(self.text(j), m)) {
                Some(j) => j,
                None => {
                    self.push(start, self.text_len, Kind::Html);
                    return n;
                }
            },
            HtmlEnd::Blank => (first..n)
                .take_while(|&j| !is_blank(self.text(j)))
                .last()
                .unwrap_or(first),
        };
        self.push(start, self.lines[last].end(), Kind::Html);
        last + 1
    }
}
