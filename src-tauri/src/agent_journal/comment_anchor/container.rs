//! Root list items and block quotes, and what is open inside them as far
//! as lazy continuation cares: a paragraph, a table, a fence, a `$$` math
//! block, or an HTML block.
//!
//! An approximation, stated: nested containers are not modelled, only their
//! markers stripped. A `$$` opener inside a container always opens math
//! (the text is canonical, so an opener the parser would escape is already
//! written escaped) and runs to its closer or the container's end. Only
//! whether a paragraph is open decides anything at the root: a table, math
//! or a closed HTML block ends it, so the next unprefixed line is not lazy.
//!
//! @module agent_journal/comment_anchor/container

use super::html::{delimiter_cells, html_ends, html_start, table_cells, HtmlEnd};
use super::lines::{
    atx, fence_close, fence_open, is_blank, lead, list_marker, quote_content, setext_underline,
    strip_cols, thematic,
};
use super::math::{math_close, math_open};
use super::scan::Scanner;

/// What is open inside a container, as far as lazy continuation cares.
#[derive(Debug, Default)]
pub(super) struct Inner {
    pub para: bool,
    /// The cell count of the open paragraph's last line, for a table's delimiter row.
    cells: usize,
    table: bool,
    fence: Option<(char, usize)>,
    math: Option<usize>,
    html: Option<HtmlEnd>,
}

impl Inner {
    pub fn blank(&mut self) {
        self.para = false;
        self.table = false;
        self.html = None;
    }

    /// Feed one line of the container's content; nested markers are stripped,
    /// at most `MAX_NESTED` of them (deeper content reads as paragraph text),
    /// which keeps a hostile `- - - … x` line linear.
    pub fn feed(&mut self, line: &str) {
        let mut c = line;
        if let Some((ch, run)) = self.fence {
            if fence_close(c, ch, run) {
                self.fence = None;
            }
            return;
        }
        if let Some(run) = self.math {
            if math_close(c).is_some_and(|n| n >= run) {
                self.math = None;
            }
            return;
        }
        for _ in 0..MAX_NESTED {
            if is_blank(c) {
                return self.blank();
            }
            if let Some(end) = self.html {
                if matches!(end, HtmlEnd::Marker(m) if html_ends(c, m)) {
                    self.html = None;
                }
                return;
            }
            if lead(c).0 >= 4 {
                return;
            }
            if let Some(f) = fence_open(c) {
                return self.open(|s| s.fence = Some(f));
            }
            if let Some(run) = math_open(c) {
                return self.open(|s| s.math = Some(run));
            }
            if atx(c).is_some() || thematic(c) || (self.para && setext_underline(c).is_some()) {
                return self.open(|_| {});
            }
            if self.para && delimiter_cells(c) == Some(self.cells) {
                return self.open(|s| s.table = true);
            }
            if let Some(q) = quote_content(c) {
                c = q;
                continue;
            }
            if list_marker(c).is_some() {
                let (_, at) = lead(c);
                let marker = c[at..].find([' ', '\t']).unwrap_or(c.len() - at);
                c = c[at + marker..].trim_start_matches([' ', '\t']);
                self.para = false;
                self.table = false;
                continue;
            }
            if let Some(end) = html_start(c, self.para) {
                let closed = matches!(end, HtmlEnd::Marker(m) if html_ends(c, m));
                return self.open(|s| s.html = (!closed).then_some(end));
            }
            self.para = !self.table;
            self.cells = table_cells(c);
            return;
        }
        self.para = !self.table;
    }

    /// A block other than a paragraph starts: whatever paragraph or table
    /// was open ends, and `set` records what is open now.
    fn open(&mut self, set: impl FnOnce(&mut Self)) {
        self.para = false;
        self.table = false;
        set(self);
    }
}

/// Nested container markers stripped from one line inside a container.
const MAX_NESTED: usize = 32;

/// Root list and block-quote blocks: their extent, by lazy continuation.
impl Scanner<'_> {
    pub(super) fn quote(&mut self, first: usize) -> usize {
        let mut inner = Inner::default();
        inner.feed(quote_content(self.text(first)).unwrap_or(""));
        let mut last = first;
        let mut j = first + 1;
        while j < self.lines.len() {
            let t = self.text(j);
            if let Some(c) = quote_content(t) {
                inner.feed(c);
            } else if is_blank(t) || !inner.para || self.interrupts(j, true) {
                break;
            }
            last = j;
            j += 1;
        }
        self.other(first, last);
        j
    }

    pub(super) fn list(&mut self, first: usize) -> usize {
        let Some(m) = list_marker(self.text(first)) else {
            return self.paragraph(first);
        };
        let kind = m.kind;
        let mut col = m.content_col;
        let mut inner = Inner::default();
        inner.feed(&strip_cols(self.text(first), col));
        let (mut item, mut item_empty, mut closed, mut blank) = (first, m.empty, false, false);
        let mut last = first;
        let mut j = first + 1;
        while j < self.lines.len() {
            let t = self.text(j);
            if is_blank(t) {
                // An item that starts empty ends at its first blank line.
                closed |= item_empty && last == item;
                blank = true;
                inner.blank();
            } else if !closed && lead(t).0 >= col {
                inner.feed(&strip_cols(t, col));
                blank = false;
                last = j;
            } else if thematic(t) {
                break;
            } else if let Some(next) = list_marker(t).filter(|n| n.kind == kind) {
                col = next.content_col;
                inner = Inner::default();
                inner.feed(&strip_cols(t, col));
                (item, item_empty, closed, blank) = (j, next.empty, false, false);
                last = j;
            } else if !blank && inner.para && !self.interrupts(j, true) {
                last = j;
            } else {
                break;
            }
            j += 1;
        }
        self.other(first, last);
        j
    }
}
