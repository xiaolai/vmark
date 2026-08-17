//! PDF outline (bookmark) injection — cross-platform, via `lopdf`.
//!
//! Purpose: give the exported PDF the sidebar table of contents that viewers
//! render from the document's `/Outlines` tree. This replaces a PDFKit
//! implementation that worked on macOS only (ADR-PDF3), so Windows and Linux
//! shipped outline-less PDFs.
//!
//! Written as ONE implementation for all three platforms rather than a
//! cross-platform path beside the macOS one. Two implementations of a single
//! feature is the duplication class this module's own history kept paying for —
//! a rule declared twice, a bound honoured by one engine and inert in the
//! other — and a second copy here would need the same heading-to-page matching
//! reproduced against a different text extractor.
//!
//! Pipeline: load the rendered PDF → extract each page's text → locate each
//! heading's page → build a nested tree from heading levels → emit the
//! `/Outlines` object graph → save in place.
//!
//! @coordinates-with heading.rs — the wire type this consumes
//! @coordinates-with commands.rs — calls this after the render completes
//! @module pdf_export/outline

use std::collections::BTreeMap;

use lopdf::{Dictionary, Document, Object, ObjectId};

use super::heading::Heading;
use super::outline_tree::{build_tree, Node};

/// Encode a title as a PDF text string.
///
/// A literal string is byte-oriented and PDF readers decode it as PDFDocEncoding,
/// so a CJK or accented heading would render as mojibake. UTF-16BE with a BOM is
/// the encoding the spec defines for anything outside that set; ASCII stays a
/// plain literal so the common case remains readable in the raw file.
fn text_string(s: &str) -> Object {
    if s.is_ascii() {
        Object::string_literal(s.as_bytes().to_vec())
    } else {
        let mut bytes = vec![0xFE, 0xFF];
        for unit in s.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        Object::string_literal(bytes)
    }
}

/// Emit one level of the tree, returning (first, last, total descendant count).
///
/// Kept as one function rather than split into id-allocation, linkage and
/// destination helpers, which an audit suggested. The three are not independent:
/// sibling linkage needs every id in the level BEFORE any dictionary is built,
/// so splitting them means passing the id vector between helpers and the seam
/// buys naming, not decoupling. The recursion is bounded — `build_tree` clamps
/// levels to 6 — and every branch is covered by the round-trip test.
fn emit(
    doc: &mut Document,
    nodes: &[Node],
    parent: ObjectId,
    pages: &BTreeMap<u32, ObjectId>,
) -> Option<(ObjectId, ObjectId, i64)> {
    if nodes.is_empty() {
        return None;
    }
    let level_ids: Vec<ObjectId> = nodes.iter().map(|_| doc.new_object_id()).collect();
    let mut total = 0i64;

    for (i, node) in nodes.iter().enumerate() {
        let id = level_ids[i];
        let mut dict = Dictionary::new();
        dict.set("Title", text_string(&node.title));
        dict.set("Parent", Object::Reference(parent));
        if i > 0 {
            dict.set("Prev", Object::Reference(level_ids[i - 1]));
        }
        if i + 1 < level_ids.len() {
            dict.set("Next", Object::Reference(level_ids[i + 1]));
        }

        // 1-based page numbers; clamp rather than drop, so a heading whose text
        // could not be located still yields a usable bookmark.
        let page_no = u32::try_from(node.page)
            .unwrap_or(u32::MAX)
            .saturating_add(1);
        if let Some(page_id) = pages.get(&page_no).or_else(|| pages.values().next()) {
            dict.set(
                "Dest",
                Object::Array(vec![
                    Object::Reference(*page_id),
                    Object::Name(b"Fit".to_vec()),
                ]),
            );
        }

        let child = emit(doc, &node.children, id, pages);
        if let Some((first, last, count)) = child {
            dict.set("First", Object::Reference(first));
            dict.set("Last", Object::Reference(last));
            // Positive count = open in the viewer's sidebar. Top levels of a
            // table of contents are far more useful expanded.
            dict.set("Count", Object::Integer(count));
            total += count;
        }

        doc.set_object(id, Object::Dictionary(dict));
        total += 1;
    }

    Some((level_ids[0], level_ids[level_ids.len() - 1], total))
}

/// Add an outline to an existing PDF, in place.
///
/// Returns `Ok(())` for an empty heading list: a document with no headings has
/// no table of contents to show, which is not a failure.
///
/// **The `String` errors here are deliberately not localized.** An audit flagged
/// them against the project's `t!()` rule, which is right for anything a user
/// reads — but the only caller (`commands.rs`) logs them as a warning and lets
/// the export succeed, because a PDF without a sidebar is a worse PDF, not a
/// failed job. Nothing reaches the UI. Translating diagnostics no user sees
/// would put ten bundles of work on strings that only ever land in a log file,
/// and would make the real user-facing set harder to audit.
pub fn add_outline(pdf_path: &str, headings: &[Heading]) -> Result<(), String> {
    if headings.is_empty() {
        return Ok(());
    }

    let mut doc = Document::load(pdf_path).map_err(|e| format!("open PDF: {e}"))?;
    let pages = doc.get_pages();
    if pages.is_empty() {
        return Err(rust_i18n::t!("errors.pdf.noPages").to_string());
    }

    // A page whose text cannot be extracted yields an empty string, which makes
    // every heading miss it. Silently that reads as "the heading is not in this
    // document" and lands the bookmark on the wrong page, so count the failures
    // and say so — the outline is still worth writing, just less reliable.
    let mut unreadable = 0usize;
    let page_texts: Vec<String> = pages
        .keys()
        .map(|n| match doc.extract_text(&[*n]) {
            Ok(t) => t,
            Err(e) => {
                log::debug!("[PDF] page {n} text extraction failed: {e}");
                unreadable += 1;
                String::new()
            }
        })
        .collect();
    if unreadable > 0 {
        log::warn!(
            "[PDF] {unreadable}/{} pages had no extractable text; some bookmarks may point at the wrong page",
            page_texts.len()
        );
    }

    // Matching is monotonic: the cursor only advances, and a heading that cannot
    // be located does NOT move it. Feeding a miss back as the next start page is
    // what used to rewind the search to page 0 and let later bookmarks land on
    // earlier pages than their predecessors.
    let mut located: Vec<(u32, String, usize)> = Vec::with_capacity(headings.len());
    let mut cursor = 0usize;
    let mut unplaced = 0usize;
    // Where each distinct heading TEXT was last placed. Searching forward from
    // the cursor is not enough on its own: the search starts AT the cursor, so a
    // heading repeated later in the document ("Overview" under two different
    // parents) matched the first occurrence twice and both bookmarks pointed at
    // the same page. Only a repeat of the same text needs to skip past its own
    // previous hit — two DIFFERENT headings frequently share one page.
    let mut placed: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for h in headings {
        let from = match placed.get(h.text.as_str()) {
            Some(prev) => cursor.max(prev.saturating_add(1)),
            None => cursor,
        };
        match super::outline_match::find_heading_page(&page_texts, &h.text, from) {
            Some(page) => {
                cursor = page;
                placed.insert(h.text.as_str(), page);
                located.push((h.level, h.text.clone(), page));
            }
            None => {
                // Keep the heading — losing it from the sidebar is worse than a
                // destination one section early — but point it at the last page
                // we are sure about rather than guessing forward.
                unplaced += 1;
                located.push((h.level, h.text.clone(), cursor));
            }
        }
    }
    if unplaced > 0 {
        log::warn!(
            "[PDF] {unplaced}/{} headings could not be located in the rendered text; \
             their bookmarks point at the preceding section",
            headings.len()
        );
    }

    let tree = build_tree(&located);
    let root_id = doc.new_object_id();
    let emitted = emit(&mut doc, &tree, root_id, &pages);

    let mut root = Dictionary::new();
    root.set("Type", Object::Name(b"Outlines".to_vec()));
    root.set("Count", Object::Integer(0));
    if let Some((first, last, count)) = emitted {
        root.set("First", Object::Reference(first));
        root.set("Last", Object::Reference(last));
        root.set("Count", Object::Integer(count));
    }
    doc.set_object(root_id, Object::Dictionary(root));

    let catalog = doc
        .catalog_mut()
        .map_err(|e| format!("PDF has no catalog: {e}"))?;
    catalog.set("Outlines", Object::Reference(root_id));
    // Ask viewers to show the sidebar. Without it most open collapsed, and the
    // outline looks absent even though it is there.
    catalog.set("PageMode", Object::Name(b"UseOutlines".to_vec()));

    // Atomic replace, shared with the page-number stamper: both rewrite a PDF
    // the renderer already produced, and both callers downgrade failure to a
    // warning, which is only honest while the original survives.
    super::pdf_io::save_atomically(&mut doc, pdf_path, ".vmark-outline-")?;

    log::info!("[PDF] outline written with {} headings", headings.len());
    Ok(())
}

#[cfg(test)]
#[path = "outline.test.rs"]
mod tests;
