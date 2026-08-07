//! Markdown structure parsing for section anchors: heading extraction, fenced
//! code-block tracking, and resolving a heading PATH to a byte range.
//!
//! Split out of `anchors.rs` for size. The seam is subject matter: this file
//! knows only about markdown text, with no notion of an edge, a revision or a
//! workspace. `anchors.rs` keeps the anchor model built on top of it.
//!
//! Fence tracking is load-bearing, not decoration: a `#` inside a fenced block
//! is not a heading, and treating it as one silently anchors an edge to a code
//! comment.
//!
//! @coordinates-with anchors.rs — the Anchor/AnchorSet model over these results
//! @module coherence/anchor_parse

use super::anchors::{AnchorResolution, MAX_INDENT, MAX_PATH_SEGMENTS, MAX_SEGMENT_BYTES};
use super::canonical::text_content_hash;

/// One parsed ATX heading.
#[derive(Clone)]
pub(super) struct Heading {
    pub(super) level: usize,
    pub(super) text: String,
    pub(super) line: usize,
}

/// One fenced-code-block state: which marker char, and how long the opener was.
pub(super) struct Fence {
    ch: char,
    len: usize,
}

/// Parse ATX headings (`#`…`######`), skipping fenced code blocks.
///
/// Fence tracking is not optional: a fenced block containing `# comment` (shell,
/// Python, a nested markdown sample) would otherwise register as a heading and
/// could capture an anchor pointing at code — a silent-suppression path.
///
/// Follows CommonMark closely enough that code cannot masquerade as structure:
/// - a closing fence must use the SAME character, be at least as long as the
///   opener, and have nothing but whitespace after it (so ```` ```not-a-close ````
///   does NOT close a block);
/// - 4+ leading spaces is indented code, so `    # Fake` is not a heading;
/// - the marker may be followed by any whitespace (space or tab), not only a
///   space.
pub(super) fn headings(text: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut fence: Option<Fence> = None;
    for (i, raw) in text.lines().enumerate() {
        let indent = raw.len() - raw.trim_start_matches(' ').len();
        let trimmed = raw.trim_start_matches(' ').trim_end();
        if indent > MAX_INDENT {
            continue; // indented code: never markup
        }
        if let Some((ch, len)) = fence_run(trimmed) {
            match &fence {
                // A closing fence: same char, at least as long, nothing but
                // whitespace after it.
                Some(open)
                    if open.ch == ch && len >= open.len && trimmed[len..].trim().is_empty() =>
                {
                    fence = None
                }
                Some(_) => {}
                None => fence = Some(Fence { ch, len }),
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        let rest = &trimmed[hashes..];
        // ATX requires whitespace after the marker — `#hashtag` is prose. An
        // empty remainder is a bare `#`, which is a valid (empty) heading.
        if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
            continue;
        }
        out.push(Heading {
            level: hashes,
            // Trailing `#`s are decorative in ATX and are not part of the text.
            text: rest.trim().trim_end_matches('#').trim().to_string(),
            line: i,
        });
    }
    out
}

/// The leading run of `\`` or `~` if it is at least 3 long.
pub(super) fn fence_run(trimmed: &str) -> Option<(char, usize)> {
    for ch in ['`', '~'] {
        let n = trimmed.chars().take_while(|c| *c == ch).count();
        if n >= 3 {
            return Some((ch, n));
        }
    }
    None
}

/// `resolve_anchor` against an ALREADY-parsed heading list. Extracted so a
/// caller resolving many paths against the same document (the anchor picker)
/// parses the text once instead of once per path — the difference between
/// O(headings) and O(headings²) reparses.
pub(super) fn resolve_in(hs: &[Heading], text: &str, path: &[String]) -> AnchorResolution {
    if path.is_empty()
        || path.len() > MAX_PATH_SEGMENTS
        || path.iter().any(|s| s.len() > MAX_SEGMENT_BYTES)
    {
        return AnchorResolution::Invalid;
    }
    let wanted: Vec<&str> = path.iter().map(|s| s.trim()).collect();
    if wanted.iter().any(|s| s.is_empty()) {
        return AnchorResolution::Invalid;
    }

    // Walk the path, requiring a DIRECT parent-child step each time.
    let mut lo = 0usize; // first heading index in the current window
    let mut hi = hs.len(); // one past the last
    let mut parent_level: Option<usize> = None;
    let mut chosen: Option<usize> = None; // index into `hs`

    for segment in &wanted {
        // Every same-named heading in the window counts toward ambiguity,
        // whatever its level: "shallowest wins" would silently ignore edits to
        // an identically-named sibling section.
        let same_text: Vec<usize> = (lo..hi).filter(|&i| hs[i].text == *segment).collect();
        let candidates: Vec<usize> = match parent_level {
            // The FIRST segment may name a heading at any depth — a path need
            // not start at the document root.
            None => same_text.clone(),
            // A later segment must be a DIRECT child of the one just chosen:
            // the shallowest level inside its section. Allowing any deeper level
            // would let an omitted intermediate ancestor match, so an otherwise
            // identical block moved under a different parent would read as
            // unchanged.
            Some(pl) => {
                let Some(child_level) = (lo..hi).map(|i| hs[i].level).filter(|l| *l > pl).min()
                else {
                    return AnchorResolution::NotFound;
                };
                same_text
                    .iter()
                    .copied()
                    .filter(|&i| hs[i].level == child_level)
                    .collect()
            }
        };
        match (candidates.len(), same_text.len()) {
            (0, _) => return AnchorResolution::NotFound,
            (1, 1) => {}
            _ => return AnchorResolution::Ambiguous,
        }
        let idx = candidates[0];
        parent_level = Some(hs[idx].level);
        chosen = Some(idx);
        lo = idx + 1;
        hi = (idx + 1..hs.len())
            .find(|&j| hs[j].level <= hs[idx].level)
            .unwrap_or(hs.len());
    }

    let Some(idx) = chosen else {
        return AnchorResolution::Invalid;
    };
    // Slice by BYTE RANGE, not by re-joining lines: joining loses the section's
    // terminating newline, so "# H\nbody" and "# H\nbody\n" would hash
    // identically even though the canonical format treats a final newline as
    // content — a silent-suppression path.
    let start_byte = line_start_byte(text, hs[idx].line);
    let end_byte = match hs.get(hi) {
        Some(next) => line_start_byte(text, next.line),
        None => text.len(),
    };
    let body = &text[start_byte..end_byte];
    AnchorResolution::Found(text_content_hash(body))
}

/// Byte offset where a 0-based line begins.
pub(super) fn line_start_byte(text: &str, line: usize) -> usize {
    let mut seen = 0usize;
    for (i, b) in text.bytes().enumerate() {
        if seen == line {
            return i;
        }
        if b == b'\n' {
            seen += 1;
        }
    }
    text.len()
}
