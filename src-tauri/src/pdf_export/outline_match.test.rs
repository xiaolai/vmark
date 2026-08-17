// Moved verbatim from the former PDFKit bookmarks.rs — this logic is
// platform-neutral, and its regressions (UTF-8 char-boundary slicing on CJK
// headings, prefix collisions like Chapter 1 vs Chapter 10) are why it is
// tested at all.
use super::*;

fn pages(texts: &[&str]) -> Vec<String> {
    texts.iter().map(|s| s.to_string()).collect()
}

// --- search_pages_with ---

#[test]
fn search_forward_finds_forward() {
    let p = pages(&["alpha", "beta", "gamma"]);
    assert_eq!(search_forward(&p, 0, |t| t.contains("beta")), Some(1));
}

#[test]
fn search_forward_does_not_wrap_behind_the_cursor() {
    // Inverted deliberately. Wrapping let a bookmark point BACKWARD past the
    // previous heading, which in a document with a table of contents reliably
    // selected the TOC's mention of a section instead of the section itself.
    let p = pages(&["alpha", "beta", "gamma"]);
    assert_eq!(search_forward(&p, 2, |t| t.contains("alpha")), None);
}

#[test]
fn search_forward_returns_none_when_not_found() {
    let p = pages(&["alpha", "beta"]);
    assert_eq!(search_forward(&p, 0, |t| t.contains("zzz")), None);
}

#[test]
fn search_forward_empty_pages() {
    let p: Vec<String> = vec![];
    assert_eq!(search_forward(&p, 0, |_| true), None);
}

// --- find_heading_page ---

#[test]
fn find_heading_exact_line_match() {
    let p = pages(&["Intro\nSome text", "Chapter 1\nMore text", "Chapter 2"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), Some(1));
}

#[test]
fn find_heading_line_starts_with() {
    // Line "Chapter 1 — Overview" starts with "Chapter 1"
    let p = pages(&["Intro", "Chapter 1 — Overview\nBody", "End"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), Some(1));
}

#[test]
fn find_heading_substring_fallback() {
    // No line starts with needle, but page contains it as substring
    let p = pages(&["Intro", "SeeChapter 1Here", "End"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), Some(1));
}

#[test]
fn find_heading_case_insensitive_fallback() {
    let p = pages(&["intro", "chapter one", "CHAPTER ONE details"]);
    assert_eq!(find_heading_page(&p, "Chapter One", 0), Some(1));
}

#[test]
fn find_heading_forward_from_start_page() {
    // Two pages have "Section" but we start searching from page 1
    let p = pages(&["Section\nfirst", "Section\nsecond", "Other"]);
    assert_eq!(find_heading_page(&p, "Section", 1), Some(1));
}

#[test]
fn find_heading_does_not_look_behind_the_cursor() {
    // Was: wraps to page 0. Headings appear in document order, so a match
    // behind the cursor is a false positive by construction.
    let p = pages(&["Target here", "Other", "Other2"]);
    assert_eq!(find_heading_page(&p, "Target", 2), None);
}

#[test]
fn find_heading_returns_none_when_not_found() {
    // Was: 0, which is indistinguishable from a genuine first-page hit — and
    // the caller fed it back as the next start page, rewinding the search.
    let p = pages(&["Page A", "Page B"]);
    assert_eq!(find_heading_page(&p, "Nonexistent", 0), None);
}

#[test]
fn find_heading_empty_text_is_unmatched() {
    // An empty heading cannot be located; claiming the start page would be a
    // guess wearing a real answer's clothes.
    let p = pages(&["A", "B", "C"]);
    assert_eq!(find_heading_page(&p, "", 1), None);
}

#[test]
fn find_heading_whitespace_only_is_unmatched() {
    let p = pages(&["A", "B"]);
    assert_eq!(find_heading_page(&p, "  ", 5), None);
}

#[test]
fn find_heading_trims_whitespace() {
    let p = pages(&["Intro", "  Chapter 2  \nBody"]);
    assert_eq!(find_heading_page(&p, "  Chapter 2  ", 0), Some(1));
}

#[test]
fn find_heading_prefix_collision_rejected() {
    // "Chapter 1" must NOT match a line that says "Chapter 10"
    let p = pages(&["Chapter 10\nSome text", "Chapter 1\nOther text"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), Some(1));
}

#[test]
fn find_heading_prefix_with_boundary_accepted() {
    // "Chapter 1" SHOULD match "Chapter 1 — Overview" (space boundary)
    let p = pages(&["Chapter 1 — Overview\nBody"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), Some(0));
}

// --- contains_with_boundary: UTF-8 char-boundary safety (WI-0.1, P1) ---

#[test]
fn contains_with_boundary_cjk_rejected_match_does_not_panic() {
    // The only occurrence of the CJK needle is preceded by an alphanumeric
    // char, so the boundary check rejects it. The advance past the rejected
    // match must land on a char boundary (not slice mid-character).
    // Under the old `start = abs + 1`, this panicked slicing the 3-byte '第'.
    assert!(!contains_with_boundary("A第一章", "第一章"));
}

#[test]
fn contains_with_boundary_finds_later_cjk_occurrence() {
    // First occurrence (after 'A') is rejected; advancing past the whole
    // match must still find the second, boundary-valid occurrence.
    // Documents the non-overlapping invariant: headings don't overlap, so
    // skipping the whole match cannot skip a *distinct* heading.
    assert!(contains_with_boundary("A第一章 第一章", "第一章"));
}

#[test]
fn contains_with_boundary_ascii_unchanged() {
    assert!(contains_with_boundary("Chapter 1 here", "Chapter 1"));
    assert!(!contains_with_boundary("Chapter 10", "Chapter 1"));
}

// --- monotonic matching (audit round 2) ---

#[test]
fn an_unmatched_heading_does_not_rewind_the_cursor() {
    // The defect this replaced: `find_heading_page` returned 0 for "not found",
    // the caller fed it back as the next start page, and one missing heading
    // sent every later search back to the top of the document.
    let p = pages(&["A", "B", "Target"]);
    assert_eq!(find_heading_page(&p, "Nonexistent", 2), None);
    // The caller keeps its cursor on None, so the next lookup still starts at 2.
    assert_eq!(find_heading_page(&p, "Target", 2), Some(2));
}

#[test]
fn a_repeated_heading_resolves_forward_not_back() {
    let p = pages(&["Overview", "Overview", "Overview"]);
    assert_eq!(find_heading_page(&p, "Overview", 0), Some(0));
    assert_eq!(find_heading_page(&p, "Overview", 1), Some(1));
    assert_eq!(find_heading_page(&p, "Overview", 2), Some(2));
}

#[test]
fn a_toc_mention_before_the_cursor_cannot_win() {
    // Page 0 is a table of contents listing every section; the real sections
    // follow. Once the cursor has passed the TOC, a later heading must not
    // resolve back onto it.
    let p = pages(&[
        "Contents\nInstallation\nUsage",
        "Installation\nbody",
        "Usage\nbody",
    ]);
    assert_eq!(find_heading_page(&p, "Usage", 2), Some(2));
    assert_eq!(find_heading_page(&p, "Installation", 1), Some(1));
}

#[test]
fn a_start_page_past_the_end_matches_nothing() {
    let p = pages(&["A", "B"]);
    assert_eq!(find_heading_page(&p, "A", 99), None);
}
