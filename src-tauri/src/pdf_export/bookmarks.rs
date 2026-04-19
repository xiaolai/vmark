//! PDF bookmark (outline) injection using PDFKit.
//!
//! After the print operation generates a PDF, this module opens it
//! with PDFKit, searches for heading text on each page, and builds
//! a hierarchical outline (bookmarks) that PDF viewers display as
//! a table of contents.

use objc2::AnyThread;
use objc2_foundation::{NSPoint, NSString};
use objc2_pdf_kit::{PDFDestination, PDFDocument, PDFOutline};

/// A heading extracted from the document for PDF bookmark (outline) injection.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Heading {
    pub level: u32,
    pub text: String,
}

/// Add bookmark outlines to an existing PDF file.
///
/// Opens the PDF, searches for each heading's text to determine its page,
/// builds a hierarchical outline, and writes the PDF back.
pub fn add_bookmarks(pdf_path: &str, headings: &[Heading]) -> Result<(), String> {
    if headings.is_empty() {
        return Ok(());
    }

    log::debug!("[PDF] adding {} bookmarks to {}", headings.len(), pdf_path);

    let url = objc2_foundation::NSURL::fileURLWithPath(&NSString::from_str(pdf_path));
    // SAFETY: NSURL was just constructed from a valid path string, and
    // PDFDocument::initWithURL is a standard Objective-C initializer that
    // returns nil (mapped to None) on failure. No main thread requirement.
    let doc = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }
        .ok_or("Failed to open PDF for bookmark injection")?;

    // SAFETY: doc is a valid PDFDocument obtained from a successful initWithURL above.
    let page_count = unsafe { doc.pageCount() };
    if page_count == 0 {
        return Err(rust_i18n::t!("errors.pdf.noPages").to_string());
    }

    log::debug!("[PDF] PDF has {} pages", page_count);

    // Build page text index for heading lookup
    let page_texts = build_page_texts(&doc, page_count);

    // Create root outline
    // SAFETY: PDFOutline::new() is a simple alloc+init with no preconditions.
    let root = unsafe { PDFOutline::new() };

    // Track outline hierarchy using a stack of (level, outline_ref_index)
    let mut items: Vec<(u32, objc2::rc::Retained<PDFOutline>)> = Vec::new();

    let mut last_page: usize = 0;
    for heading in headings {
        let page_idx = find_heading_page(&page_texts, &heading.text, last_page);
        last_page = page_idx;
        // SAFETY: doc is valid and page_idx is bounded by page_count (from find_heading_page).
        // pageAtIndex returns nil (None) for out-of-range indices, handled by the if-let below.
        let page = unsafe { doc.pageAtIndex(page_idx as objc2_foundation::NSUInteger) };

        // SAFETY: PDFOutline::new() is a simple alloc+init with no preconditions.
        let item = unsafe { PDFOutline::new() };
        // SAFETY: item was just created above; NSString::from_str produces a valid string.
        unsafe {
            item.setLabel(Some(&NSString::from_str(&heading.text)));
        }

        if let Some(page) = page {
            // Point to top of the page where heading was found
            // SAFETY: page is a valid PDFPage obtained from pageAtIndex (guarded by if-let).
            // PDFDestination::initWithPage_atPoint is a standard initializer.
            let dest = unsafe {
                PDFDestination::initWithPage_atPoint(
                    PDFDestination::alloc(),
                    &page,
                    NSPoint::new(0.0, 10000.0), // top of page (PDF coords: y=0 is bottom)
                )
            };
            // SAFETY: item and dest are valid objects created above.
            unsafe { item.setDestination(Some(&dest)) };
        }

        // Build hierarchy: find the right parent for this heading level
        // Pop items from stack that are at the same or lower level
        while let Some((lvl, _)) = items.last() {
            if *lvl >= heading.level {
                items.pop();
            } else {
                break;
            }
        }

        if let Some((_, parent)) = items.last() {
            // SAFETY: parent is a valid PDFOutline from the items stack.
            // Inserting at numberOfChildren appends to the end.
            let child_count = unsafe { parent.numberOfChildren() };
            unsafe { parent.insertChild_atIndex(&item, child_count) };
        } else {
            // SAFETY: root is a valid PDFOutline created at the top of this function.
            let child_count = unsafe { root.numberOfChildren() };
            unsafe { root.insertChild_atIndex(&item, child_count) };
        }

        items.push((heading.level, item));
    }

    // Set the outline root and expand top-level items
    // SAFETY: root and doc are valid objects created/validated earlier in this function.
    // setOutlineRoot transfers the outline tree to the document.
    unsafe {
        root.setIsOpen(true);
        doc.setOutlineRoot(Some(&root));
    }

    // Write back
    // SAFETY: doc is a valid PDFDocument with the outline now attached.
    // writeToFile writes to a valid path and returns a bool indicating success.
    let success = unsafe { doc.writeToFile(&NSString::from_str(pdf_path)) };
    if !success {
        return Err(rust_i18n::t!("errors.pdf.writeFailed").to_string());
    }

    log::info!("[PDF] bookmarks added successfully");
    Ok(())
}

/// Extract text content from each page for heading search.
fn build_page_texts(
    doc: &PDFDocument,
    page_count: objc2_foundation::NSUInteger,
) -> Vec<String> {
    let mut texts = Vec::with_capacity(page_count as usize);
    for i in 0..page_count {
        // SAFETY: doc is a valid PDFDocument and i is in range [0, page_count).
        // pageAtIndex returns None for invalid indices; string() returns the
        // text content of the page as an NSString (or None if empty).
        let text = unsafe {
            doc.pageAtIndex(i)
                .and_then(|page| page.string())
                .map(|s| s.to_string())
                .unwrap_or_default()
        };
        texts.push(text);
    }
    texts
}

/// Find which page contains a heading by searching page text.
/// Searches forward from `start_page` to handle duplicate heading texts correctly.
/// Falls back to searching from page 0 if not found after start_page.
/// Returns 0 (first page) if not found anywhere.
fn find_heading_page(page_texts: &[String], heading_text: &str, start_page: usize) -> usize {
    let needle = heading_text.trim();
    if needle.is_empty() {
        return start_page.min(page_texts.len().saturating_sub(1));
    }

    // Try line-based matching first (heading text should appear as a distinct line
    // or standalone phrase), then fall back to substring contains.
    // This reduces false positives where "Error" matches "Error Handling Framework".

    // Pass 1: Line-level match (most precise) — check if any line in the page
    // starts with or equals the heading text. Requires a word boundary after
    // the prefix to avoid "Chapter 1" matching "Chapter 10".
    if let Some(idx) = search_pages_with(page_texts, start_page, |text| {
        text.lines().any(|line| {
            let trimmed = line.trim();
            if trimmed == needle {
                return true;
            }
            if let Some(rest) = trimmed.strip_prefix(needle) {
                // Require non-alphanumeric boundary after the needle
                rest.starts_with(|c: char| !c.is_alphanumeric())
            } else {
                false
            }
        })
    }) {
        return idx;
    }

    // Pass 2: Substring with word boundary (handles run-together text from PDF extraction)
    if let Some(idx) = search_pages_with(page_texts, start_page, |text| {
        contains_with_boundary(text, needle)
    }) {
        return idx;
    }

    // Pass 3: Case-insensitive substring with word boundary
    let lower = needle.to_lowercase();
    if let Some(idx) = search_pages_with(page_texts, start_page, |text| {
        contains_with_boundary(&text.to_lowercase(), &lower)
    }) {
        return idx;
    }

    // Pass 4: Plain substring (last resort — accepts partial matches)
    if let Some(idx) = search_pages_with(page_texts, start_page, |text| {
        text.contains(needle)
    }) {
        return idx;
    }

    0
}

/// Search pages starting from `start_page`, wrapping around to the beginning.
/// Returns the first page index where `predicate` returns true.
fn search_pages_with<F>(page_texts: &[String], start_page: usize, predicate: F) -> Option<usize>
where
    F: Fn(&str) -> bool,
{
    // Search forward from start_page
    for (i, text) in page_texts.iter().enumerate().skip(start_page) {
        if predicate(text) {
            return Some(i);
        }
    }
    // Wrap around: search from beginning up to start_page
    for (i, text) in page_texts.iter().enumerate().take(start_page) {
        if predicate(text) {
            return Some(i);
        }
    }
    None
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
                .map_or(false, |c| c.is_alphanumeric());
        let after_ok = abs + nlen >= bytes.len()
            || !haystack[abs + nlen..]
                .chars()
                .next()
                .map_or(false, |c| c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

#[cfg(test)]
mod tests {
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
}
