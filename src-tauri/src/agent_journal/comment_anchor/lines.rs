//! Line-level CommonMark classifiers for the outline scanner: indentation,
//! ATX and setext headings, thematic breaks, list and quote markers, and
//! code fences.
//!
//! Each classifier reads one line without its line ending. Columns follow
//! CommonMark: a tab advances to the next multiple of four.
//!
//! @module agent_journal/comment_anchor/lines

use super::work;
use crate::coherence::anchor_parse::fence_run;

/// One source line: where it starts and its text without the line ending.
#[derive(Debug, Clone, Copy)]
pub(super) struct Line<'a> {
    pub start: usize,
    pub text: &'a str,
}

impl Line<'_> {
    /// Byte offset just past the line's text (before its line ending).
    pub fn end(&self) -> usize {
        self.start + self.text.len()
    }
}

/// Split on every CommonMark line ending (`\r\n`, `\r`, `\n`).
pub(super) fn split_lines(text: &str) -> Vec<Line<'_>> {
    let bytes = text.as_bytes();
    work::add(bytes.len());
    let mut out = Vec::new();
    let (mut start, mut i) = (0, 0);
    while i < bytes.len() {
        let width = match bytes[i] {
            b'\n' => 1,
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => 2,
            b'\r' => 1,
            _ => {
                i += 1;
                continue;
            }
        };
        out.push(Line {
            start,
            text: &text[start..i],
        });
        i += width;
        start = i;
    }
    if start < bytes.len() {
        out.push(Line {
            start,
            text: &text[start..],
        });
    }
    out
}

const fn is_space_or_tab(b: u8) -> bool {
    b == b' ' || b == b'\t'
}

/// Leading whitespace: its width in columns and in bytes.
pub(super) fn lead(s: &str) -> (usize, usize) {
    let mut cols = 0;
    for (i, b) in s.bytes().enumerate() {
        match b {
            b' ' => cols += 1,
            b'\t' => cols += 4 - cols % 4,
            _ => return (cols, i),
        }
    }
    (cols, s.len())
}

pub(super) fn is_blank(s: &str) -> bool {
    s.bytes().all(is_space_or_tab)
}

/// The line after at most three columns of indentation; `None` when indented code.
pub(super) fn unindented(s: &str) -> Option<&str> {
    let (cols, at) = lead(s);
    (cols <= 3).then(|| &s[at..])
}

fn trim_end_ws(s: &str) -> &str {
    s.trim_end_matches([' ', '\t'])
}

/// An ATX heading: its depth and its text's byte range within `s`.
pub(super) fn atx(s: &str) -> Option<(u8, usize, usize)> {
    let r = unindented(s)?;
    let n = r.bytes().take_while(|b| *b == b'#').count();
    let after = &r[n..];
    if n == 0 || n > 6 || !(after.is_empty() || after.starts_with([' ', '\t'])) {
        return None;
    }
    let start = s.len() - after.trim_start_matches([' ', '\t']).len();
    let mut content = trim_end_ws(&s[start..]);
    let body = content.trim_end_matches('#');
    if body.len() < content.len() && (body.is_empty() || body.ends_with([' ', '\t'])) {
        content = trim_end_ws(body);
    }
    Some((n as u8, start, start + content.len()))
}

/// A setext underline: depth 1 for `=`, 2 for `-`.
pub(super) fn setext_underline(s: &str) -> Option<u8> {
    let r = trim_end_ws(unindented(s)?);
    if r.is_empty() {
        None
    } else if r.bytes().all(|b| b == b'=') {
        Some(1)
    } else if r.bytes().all(|b| b == b'-') {
        Some(2)
    } else {
        None
    }
}

pub(super) fn thematic(s: &str) -> bool {
    let Some(r) = unindented(s) else { return false };
    let Some(mark) = r
        .bytes()
        .next()
        .filter(|b| matches!(*b, b'*' | b'-' | b'_'))
    else {
        return false;
    };
    r.bytes().all(|b| b == mark || is_space_or_tab(b))
        && r.bytes().filter(|b| *b == mark).count() >= 3
}

/// What starts a list item: a bullet character or an ordered delimiter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ListKind {
    Bullet(u8),
    Ordered(u8),
}

/// A list item's opening line.
#[derive(Debug, Clone, Copy)]
pub(super) struct ListMarker {
    pub kind: ListKind,
    pub value: u64,
    pub empty: bool,
    /// The column the item's content starts at.
    pub content_col: usize,
}

pub(super) fn list_marker(s: &str) -> Option<ListMarker> {
    let (cols, at) = lead(s);
    if cols > 3 {
        return None;
    }
    let r = &s.as_bytes()[at..];
    let digits = r.iter().take_while(|b| b.is_ascii_digit()).count();
    let (kind, width, value) = match *r.first()? {
        b @ (b'-' | b'+' | b'*') => (ListKind::Bullet(b), 1, 0),
        _ if (1..=9).contains(&digits) && matches!(r.get(digits), Some(b'.' | b')')) => {
            let value = s[at..at + digits].parse().ok()?;
            (ListKind::Ordered(r[digits]), digits + 1, value)
        }
        _ => return None,
    };
    let after = &r[width..];
    if !after.is_empty() && !is_space_or_tab(after[0]) {
        return None;
    }
    let marker_end = cols + width;
    let mut col = marker_end;
    let mut ws = 0;
    for b in after.iter().take_while(|b| is_space_or_tab(**b)) {
        col += if *b == b'\t' { 4 - col % 4 } else { 1 };
        ws += 1;
    }
    let empty = ws == after.len();
    let content_col = if empty || col - marker_end >= 5 {
        marker_end + 1
    } else {
        col
    };
    Some(ListMarker {
        kind,
        value,
        empty,
        content_col,
    })
}

/// `s` with its first `n` columns removed; a tab that straddles `n` leaves its remainder as spaces.
pub(super) fn strip_cols(s: &str, n: usize) -> String {
    let mut col = 0;
    for (i, ch) in s.char_indices() {
        if col >= n {
            return format!("{}{}", " ".repeat(col - n), &s[i..]);
        }
        col += if ch == '\t' { 4 - col % 4 } else { 1 };
    }
    " ".repeat(col.saturating_sub(n))
}

/// A block quote line's content after `>` and one optional space or tab.
pub(super) fn quote_content(s: &str) -> Option<&str> {
    let r = unindented(s)?.strip_prefix('>')?;
    Some(r.strip_prefix([' ', '\t']).unwrap_or(r))
}

/// Leading spaces (not tabs) when there are at most three of them.
pub(super) fn up_to_three_spaces(s: &str) -> Option<&str> {
    let n = s.bytes().take_while(|b| *b == b' ').count();
    (n <= 3).then(|| &s[n..])
}

/// A code fence opener: its character and run length.
pub(super) fn fence_open(s: &str) -> Option<(char, usize)> {
    let r = up_to_three_spaces(s)?;
    let (ch, run) = fence_run(r)?;
    // CommonMark: a backtick fence's info string cannot contain a backtick.
    (ch != '`' || !r[run..].contains('`')).then_some((ch, run))
}

/// Whether `s` closes a fence opened with `ch` repeated `run` times.
pub(super) fn fence_close(s: &str, ch: char, run: usize) -> bool {
    let Some(r) = up_to_three_spaces(s) else {
        return false;
    };
    matches!(fence_run(r), Some((c, n)) if c == ch && n >= run && is_blank(&r[n..]))
}
