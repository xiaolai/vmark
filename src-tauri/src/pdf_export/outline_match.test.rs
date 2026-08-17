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
fn search_pages_with_finds_forward() {
    let p = pages(&["alpha", "beta", "gamma"]);
    assert_eq!(search_pages_with(&p, 0, |t| t.contains("beta")), Some(1));
}

#[test]
fn search_pages_with_wraps_around() {
    let p = pages(&["alpha", "beta", "gamma"]);
    assert_eq!(search_pages_with(&p, 2, |t| t.contains("alpha")), Some(0));
}

#[test]
fn search_pages_with_returns_none_when_not_found() {
    let p = pages(&["alpha", "beta"]);
    assert_eq!(search_pages_with(&p, 0, |t| t.contains("zzz")), None);
}

#[test]
fn search_pages_with_empty_pages() {
    let p: Vec<String> = vec![];
    assert_eq!(search_pages_with(&p, 0, |_| true), None);
}

// --- find_heading_page ---

#[test]
fn find_heading_exact_line_match() {
    let p = pages(&["Intro\nSome text", "Chapter 1\nMore text", "Chapter 2"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), 1);
}

#[test]
fn find_heading_line_starts_with() {
    // Line "Chapter 1 — Overview" starts with "Chapter 1"
    let p = pages(&["Intro", "Chapter 1 — Overview\nBody", "End"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), 1);
}

#[test]
fn find_heading_substring_fallback() {
    // No line starts with needle, but page contains it as substring
    let p = pages(&["Intro", "SeeChapter 1Here", "End"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), 1);
}

#[test]
fn find_heading_case_insensitive_fallback() {
    let p = pages(&["intro", "chapter one", "CHAPTER ONE details"]);
    assert_eq!(find_heading_page(&p, "Chapter One", 0), 1);
}

#[test]
fn find_heading_forward_from_start_page() {
    // Two pages have "Section" but we start searching from page 1
    let p = pages(&["Section\nfirst", "Section\nsecond", "Other"]);
    assert_eq!(find_heading_page(&p, "Section", 1), 1);
}

#[test]
fn find_heading_wraps_to_find_earlier_page() {
    let p = pages(&["Target here", "Other", "Other2"]);
    assert_eq!(find_heading_page(&p, "Target", 2), 0);
}

#[test]
fn find_heading_returns_zero_when_not_found() {
    let p = pages(&["Page A", "Page B"]);
    assert_eq!(find_heading_page(&p, "Nonexistent", 0), 0);
}

#[test]
fn find_heading_empty_text_returns_start_page() {
    let p = pages(&["A", "B", "C"]);
    assert_eq!(find_heading_page(&p, "", 1), 1);
}

#[test]
fn find_heading_empty_text_clamps_to_last_page() {
    let p = pages(&["A", "B"]);
    assert_eq!(find_heading_page(&p, "  ", 5), 1);
}

#[test]
fn find_heading_trims_whitespace() {
    let p = pages(&["Intro", "  Chapter 2  \nBody"]);
    assert_eq!(find_heading_page(&p, "  Chapter 2  ", 0), 1);
}

#[test]
fn find_heading_prefix_collision_rejected() {
    // "Chapter 1" must NOT match a line that says "Chapter 10"
    let p = pages(&["Chapter 10\nSome text", "Chapter 1\nOther text"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), 1);
}

#[test]
fn find_heading_prefix_with_boundary_accepted() {
    // "Chapter 1" SHOULD match "Chapter 1 — Overview" (space boundary)
    let p = pages(&["Chapter 1 — Overview\nBody"]);
    assert_eq!(find_heading_page(&p, "Chapter 1", 0), 0);
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
