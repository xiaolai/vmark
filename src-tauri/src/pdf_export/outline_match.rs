//! Locating a heading's page in an already-rendered PDF.
//!
//! Purpose: the outline needs a page number per heading, and the only thing the
//! rendered PDF carries is text. This matches heading text against extracted
//! page text in four passes of decreasing strictness, so a precise match wins
//! before a loose one can claim the wrong page.
//!
//! Pure and platform-neutral by design: it was the only part of the former
//! PDFKit injector that did not depend on macOS, and keeping it intact is what
//! let the outline go cross-platform without rewriting the matching.
//!
//! @coordinates-with outline.rs — the only consumer
//! @module pdf_export/outline_match

/// Find which page contains a heading by searching page text.
/// Searches forward from `start_page` to handle duplicate heading texts correctly.
/// Falls back to searching from page 0 if not found after start_page.
/// Returns 0 (first page) if not found anywhere.
/// The page a heading appears on, if it can be located.
///
/// Returns `None` rather than a page number when nothing matches. The previous
/// sentinel was `0`, which is indistinguishable from a genuine first-page hit —
/// and because the caller fed the result back as the next search's start page, a
/// single unmatched heading rewound the cursor to the top of the document and
/// every later heading re-matched against pages it had already passed.
pub(super) fn find_heading_page(
    page_texts: &[String],
    heading_text: &str,
    start_page: usize,
) -> Option<usize> {
    let needle = heading_text.trim();
    if needle.is_empty() {
        return None;
    }

    // Four passes, strictest first, so a precise match always beats a loose one.
    // Collapsed into a table because the only thing that differed between them
    // was the predicate — the surrounding "search forward, return on hit" was
    // written out four times, and a fifth pass would have been a fifth copy.
    //
    // Order is load-bearing, not incidental:
    //   1. whole-line match — the shape a real heading takes in extracted text,
    //      and the pass that stops "Chapter 1" claiming a "Chapter 10" page
    //   2. substring with word boundaries on both sides
    //   3. the same, case-insensitively
    //   4. plain substring — see the note at the bottom of this list
    let lower = needle.to_lowercase();
    let passes: [&dyn Fn(&str) -> bool; 4] = [
        &|text: &str| {
            text.lines().any(|line| {
                let trimmed = line.trim();
                trimmed == needle
                    || trimmed
                        .strip_prefix(needle)
                        .is_some_and(|rest| rest.starts_with(|c: char| !c.is_alphanumeric()))
            })
        },
        &|text: &str| contains_with_boundary(text, needle),
        &|text: &str| contains_with_boundary(&text.to_lowercase(), &lower),
        // Last resort. An audit flagged this as defeating the boundary checks
        // above, and in isolation it does. Kept on evidence: PDF text extraction
        // glues words together when glyph positions imply no space, so a heading
        // really does appear as "SeeChapter 1Here" — pinned by a test — and
        // passes 1-3 reject that correctly. The collision the boundary rule
        // exists to stop is caught by pass 1, which runs first. With no
        // wrapping, a false positive here can only land at or after the previous
        // heading, never behind it.
        &|text: &str| text.contains(needle),
    ];

    passes
        .iter()
        .find_map(|predicate| search_forward(page_texts, start_page, predicate))
}

/// How many times `heading_text` appears as a heading-shaped line on `page`.
///
/// Used to decide whether a REPEATED heading can resolve to the page its
/// previous occurrence took. The caller used to force a repeat to start one page
/// later unconditionally, which made two identically-named sections on a single
/// page impossible to place — the second bookmark jumped forward to wherever the
/// text next appeared, or fell back to the cursor. Counting lets the repeat stay
/// put when the page really does carry it twice, while a page carrying it once
/// still pushes the repeat forward, which is what the original guard was for.
///
/// Deliberately uses only the strict whole-line shape. The looser substring
/// passes exist to rescue mangled extraction, and counting with them would let
/// one visual heading plus a body mention read as two headings.
pub(super) fn occurrences_on_page(page: &str, heading_text: &str) -> usize {
    let needle = heading_text.trim();
    if needle.is_empty() {
        return 0;
    }
    page.lines()
        .filter(|line| {
            let trimmed = line.trim();
            trimmed == needle
                || trimmed
                    .strip_prefix(needle)
                    .is_some_and(|rest| rest.starts_with(|c: char| !c.is_alphanumeric()))
        })
        .count()
}

/// Search pages from `start_page` forward. Never wraps.
///
/// Wrapping used to let a bookmark point BACKWARD past the previous heading,
/// which in a document with a table of contents reliably selected the TOC's own
/// mention of a section instead of the section itself. Headings appear in
/// document order, so a match behind the cursor is a false positive by
/// construction.
fn search_forward<F>(page_texts: &[String], start_page: usize, predicate: F) -> Option<usize>
where
    F: Fn(&str) -> bool,
{
    page_texts
        .iter()
        .enumerate()
        .skip(start_page)
        .find(|(_, text)| predicate(text))
        .map(|(i, _)| i)
}

/// Check if `haystack` contains `needle` with a non-alphanumeric boundary
/// (or string boundary) on both sides. Prevents "Chapter 1" matching "Chapter 10".
fn contains_with_boundary(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let nlen = needle.len();
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let abs = start + pos;
        let before_ok = abs == 0
            || !haystack[..abs]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric());
        let after_ok = abs + nlen >= bytes.len()
            || !haystack[abs + nlen..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        // Advance past the whole match (a char boundary, since `needle` is a
        // substring), not by one byte — `abs + 1` can land mid-character and
        // panic when slicing a multibyte (CJK/emoji) heading. Headings don't
        // overlap, so skipping the whole match cannot skip a distinct heading.
        // `.max(1)` guards the degenerate empty-needle case against an infinite loop.
        start = abs + nlen.max(1);
    }
    false
}

#[cfg(test)]
#[path = "outline_match.test.rs"]
mod tests;
