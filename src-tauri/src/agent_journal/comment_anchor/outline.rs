//! Root-level headings and blocks of canonical Markdown, read the way the
//! production Markdown parser reads them, with offsets in UTF-16 units.
//!
//! Key decisions:
//!   - A heading's text is its content's source slice, not rendered text:
//!     an ATX heading without its opening and closing sequences, a setext
//!     heading from its first character to its last line's trimmed end.
//!   - The parser's document-level switches are mirrored: frontmatter is a
//!     block only when a closing fence exists; setext headings are off when
//!     the document holds an indented lone list marker outside fences and
//!     indented code; `<details>` blocks group their HTML open and close
//!     nodes, and what is between them is not at the root.
//!
//! @module agent_journal/comment_anchor/outline

use std::collections::HashMap;

use super::html::{details_close_at, details_open_at, details_probe};
use super::lines::{fence_close, fence_open, split_lines, Line};
use super::scan::{scan, Block, Kind};
use super::work;

/// A root-level heading; `offset` is its first line's start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub depth: u8,
    pub offset: u64,
    pub text: String,
}

/// A document's root headings and root block ranges, in UTF-16 units.
pub(super) struct Outline {
    pub headings: Vec<Heading>,
    pub blocks: Vec<(u64, u64)>,
}

/// The root-level headings of `text`.
pub fn headings(text: &str) -> Vec<Heading> {
    outline(text).headings
}

pub(super) fn outline(text: &str) -> Outline {
    let lines = split_lines(text);
    let mut blocks = Vec::new();
    let mut from = 0;
    if let Some(close) = frontmatter_close(text, &lines) {
        blocks.push(Block {
            start: 0,
            end: lines[close].end(),
            kind: Kind::Other,
        });
        from = close + 1;
    }
    blocks.extend(scan(
        text.len(),
        &lines,
        from,
        !has_ambiguous_list_underline(text),
    ));
    if details_probe(text) {
        blocks = group_details(text, blocks);
    }
    let mut at = Utf16Cursor {
        text,
        byte: 0,
        unit: 0,
    };
    let mut out = Outline {
        headings: Vec::new(),
        blocks: Vec::with_capacity(blocks.len()),
    };
    for b in blocks {
        if let Kind::Heading {
            depth,
            line,
            text: (from, to),
        } = b.kind
        {
            let offset = at.unit_at(line);
            out.headings.push(Heading {
                depth,
                offset,
                text: text[from..to].to_string(),
            });
        }
        out.blocks.push((at.unit_at(b.start), at.unit_at(b.end)));
    }
    out
}

/// The heading path (outermost first) of the section holding `offset`.
pub(super) fn heading_path_at(headings: &[Heading], offset: u64) -> Vec<String> {
    let mut stack: Vec<&Heading> = Vec::new();
    for h in headings.iter().take_while(|h| h.offset <= offset) {
        work::add(1);
        while stack.last().is_some_and(|top| top.depth >= h.depth) {
            stack.pop();
        }
        stack.push(h);
    }
    stack.into_iter().map(|h| h.text.clone()).collect()
}

fn is_frontmatter_fence(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|rest| rest.bytes().all(|b| b == b' ' || b == b'\t'))
}

/// The closing fence line of frontmatter opening the document.
fn frontmatter_close(text: &str, lines: &[Line<'_>]) -> Option<usize> {
    if !text.starts_with("---") || !is_frontmatter_fence(lines.first()?.text) {
        return None;
    }
    (1..lines.len()).find(|&k| {
        work::add(lines[k].text.len());
        is_frontmatter_fence(lines[k].text)
    })
}

/// An indented lone list marker (`  -`) outside fences and indented code,
/// lines split on `\n` only, as the parser's own check does.
fn has_ambiguous_list_underline(text: &str) -> bool {
    let mut fence: Option<(char, usize)> = None;
    for line in text.split('\n') {
        work::add(line.len() + 1);
        if let Some((ch, run)) = fence {
            if fence_close(line.strip_suffix('\r').unwrap_or(line), ch, run) {
                fence = None;
            }
            continue;
        }
        if let Some(open) = fence_open(line) {
            fence = Some(open);
            continue;
        }
        if line.starts_with("    ") || line.starts_with('\t') {
            continue;
        }
        let marker = line.trim_start_matches([' ', '\t']);
        let indented = marker.len() < line.len();
        let mut rest = marker.bytes();
        if indented
            && matches!(rest.next(), Some(b'-' | b'*' | b'+'))
            && rest.all(|b| b == b' ' || b == b'\t')
        {
            return true;
        }
    }
    false
}

/// Group root HTML blocks into `<details>` blocks as the parser's details
/// plugin does: an HTML node holding a whole `<details>…</details>` stands
/// alone; an opening node runs to the HTML node whose `</details>` brings
/// the nesting depth back to zero. Unclosed openers stay as they are.
fn group_details(text: &str, blocks: Vec<Block>) -> Vec<Block> {
    let value = |b: &Block| {
        work::add(b.end - b.start);
        &text[b.start..b.end]
    };
    let html = |b: &Block| b.kind == Kind::Html;
    // Each HTML node moves the depth by +1 per opening and -1 per closing
    // tag it holds; an opener at `i` closes at the first later node where
    // the running sum drops one below its value at `i`.
    let delta: Vec<i64> = blocks
        .iter()
        .map(|b| {
            if !html(b) {
                return 0;
            }
            i64::from(details_open_at(value(b)).is_some())
                - i64::from(details_close_at(value(b)).is_some())
        })
        .collect();
    let mut sums = Vec::with_capacity(blocks.len());
    let mut running = 0;
    for d in &delta {
        running += d;
        sums.push(running);
    }
    let mut next_at: HashMap<i64, usize> = HashMap::new();
    let mut closes_at = vec![None; blocks.len()];
    for i in (0..blocks.len()).rev() {
        closes_at[i] = next_at.get(&(sums[i] - 1)).copied();
        next_at.insert(sums[i], i);
    }
    let mut out = Vec::with_capacity(blocks.len());
    let mut i = 0;
    while i < blocks.len() {
        let b = blocks[i];
        if html(&b) && standalone_details(value(&b)) {
            out.push(Block {
                kind: Kind::Other,
                ..b
            });
        } else if let Some(close) =
            closes_at[i].filter(|_| html(&b) && details_open_at(value(&b)).is_some())
        {
            out.push(Block {
                start: b.start,
                end: blocks[close].end,
                kind: Kind::Other,
            });
            i = close;
        } else {
            out.push(b);
        }
        i += 1;
    }
    out
}

/// One HTML node that is a whole `<details>…</details>`, nothing around it.
fn standalone_details(v: &str) -> bool {
    match (details_open_at(v), details_close_at(v)) {
        (Some(open), Some(close)) if close > open => {
            v[..open].trim().is_empty() && v[close + "</details>".len()..].trim().is_empty()
        }
        _ => false,
    }
}

/// Converts ascending byte offsets to UTF-16 offsets in one pass.
struct Utf16Cursor<'a> {
    text: &'a str,
    byte: usize,
    unit: u64,
}

impl Utf16Cursor<'_> {
    fn unit_at(&mut self, byte: usize) -> u64 {
        if byte < self.byte {
            (self.byte, self.unit) = (0, 0);
        }
        work::add(byte - self.byte);
        self.unit += self.text[self.byte..byte].encode_utf16().count() as u64;
        self.byte = byte;
        self.unit
    }
}
