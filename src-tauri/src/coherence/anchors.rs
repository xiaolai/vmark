//! Section-anchored edges — design-lifecycle-and-anchors.md §B.
//!
//! An edge pins `(upstream object, upstream revision)`, so ANY edit to a large
//! upstream reopens EVERY dependent edge — even when the passage the dependency
//! actually rests on never changed. Measured cost (2026-07-20): **11 of 28 edges
//! reopened, several 4×**. An anchor narrows the question from "did the file
//! change?" to "did the part I depend on change?".
//!
//! **Anchors are their own ledger entry, not an `InputRef` field.** The workflow
//! that motivates them is reactive — the logbook knows which edges are expensive
//! (`resolutions > 1`), so the prompt is "this reopened 4×, anchor it?" *after*
//! the fact. An already-appended transformation cannot be edited, so the anchor
//! must be a separate, revisable record.
//!
//! **Heading paths, not line ranges.** `["5. Resolution", "5.2 Waivers"]`
//! survives edits above it; a line range does not survive ordinary editing.
//!
//! **A lost anchor flags LOUDLY** — it never degrades to whole-file behaviour.
//! A vanished or ambiguous heading is strong evidence the dependency genuinely
//! broke, and silently falling back would hide exactly the signal worth having.

use super::canonical::{canonicalize_text, text_content_hash};
use super::types::ContentHash;

/// What happened when an anchor was resolved against a document.
#[derive(Debug, Clone, PartialEq)]
pub enum AnchorResolution {
    /// The heading path resolved to exactly one section.
    Found(ContentHash),
    /// No heading matched — the section was renamed or removed.
    NotFound,
    /// More than one section matched. Deliberately NOT "pick the first": an
    /// ambiguous anchor could silently start tracking the wrong section, which
    /// is worse than admitting the anchor no longer identifies one thing.
    Ambiguous,
    /// The path itself is unusable (empty, or all-empty segments).
    Invalid,
}

/// One parsed ATX heading.
struct Heading {
    level: usize,
    text: String,
    line: usize,
}

/// Parse ATX headings (`#`…`######`), skipping fenced code blocks.
///
/// Fence tracking is not optional: a fenced block containing `# comment` (shell,
/// Python, a nested markdown sample) would otherwise register as a heading and
/// could capture an anchor pointing at code.
fn headings(text: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut fence: Option<String> = None;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        // ``` or ~~~ fences, of any length ≥3; a fence closes only on the same
        // marker character, so ``` inside a ~~~ block does not end it.
        if let Some(marker) = fence_marker(trimmed) {
            match &fence {
                Some(open) if marker.starts_with(open.as_str()) => fence = None,
                Some(_) => {}
                None => fence = Some(marker),
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
        // `#hashtag` is not a heading — ATX requires a space after the hashes.
        if !rest.starts_with(' ') && !rest.is_empty() {
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

fn fence_marker(trimmed: &str) -> Option<String> {
    for ch in ['`', '~'] {
        let n = trimmed.chars().take_while(|c| *c == ch).count();
        if n >= 3 {
            return Some(std::iter::repeat_n(ch, n).collect());
        }
    }
    None
}

/// Resolve a heading path to that section's normalised content hash.
///
/// The section is the heading line plus its body up to the next heading of the
/// SAME OR HIGHER level (i.e. subsections are included — depending on "§5" means
/// depending on all of §5). Content is canonicalised with the same rules capture
/// uses (CRLF, trailing whitespace, CJK spacing) so cosmetic edits do not
/// register as changes.
///
/// Matching is exact on trimmed heading text. Case and punctuation are
/// significant: renaming "5.2 Waivers" to "5.2 waivers" IS a change worth
/// surfacing, and quietly matching it would defeat the point.
pub fn resolve_anchor(text: &str, path: &[String]) -> AnchorResolution {
    let wanted: Vec<&str> = path
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if wanted.is_empty() || wanted.len() != path.len() {
        return AnchorResolution::Invalid;
    }
    let hs = headings(text);
    let lines: Vec<&str> = text.lines().collect();

    // Walk the path, narrowing the search window at each step.
    let mut lo = 0usize;
    let mut hi = lines.len();
    let mut level = 0usize;
    let mut chosen: Option<usize> = None;

    for segment in &wanted {
        let matches: Vec<&Heading> = hs
            .iter()
            .filter(|h| h.line >= lo && h.line < hi && h.level > level && h.text == *segment)
            .collect();
        // Only consider the SHALLOWEST level that matches, so a path segment
        // naming a top-level section is not confused by a same-named subsection.
        let Some(min_level) = matches.iter().map(|h| h.level).min() else {
            return AnchorResolution::NotFound;
        };
        let at: Vec<&&Heading> = matches.iter().filter(|h| h.level == min_level).collect();
        if at.len() > 1 {
            return AnchorResolution::Ambiguous;
        }
        let h = at[0];
        level = h.level;
        lo = h.line;
        hi = hs
            .iter()
            .find(|o| o.line > h.line && o.level <= h.level)
            .map(|o| o.line)
            .unwrap_or(lines.len());
        chosen = Some(h.line);
    }

    let Some(start) = chosen else {
        return AnchorResolution::Invalid;
    };
    let body = lines[start..hi].join("\n");
    AnchorResolution::Found(text_content_hash(&canonicalize_text(&body)))
}

#[cfg(test)]
#[path = "anchors.test.rs"]
mod tests;
