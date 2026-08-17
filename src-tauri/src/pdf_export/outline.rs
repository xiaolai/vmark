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

/// One node of the outline tree, before it becomes PDF objects.
///
/// Kept separate from the emission step so the shape of the tree can be tested
/// without a PDF: nesting is decided entirely by heading level, and that is
/// where an off-by-one puts a section under the wrong parent.
#[derive(Debug, PartialEq)]
pub(crate) struct Node {
    pub title: String,
    /// Zero-based page index.
    pub page: usize,
    pub children: Vec<Node>,
}

/// Nest a flat, ordered heading list by level.
///
/// A level that jumps (h1 → h3 with no h2) attaches to the nearest shallower
/// ancestor rather than being dropped, and a document that opens at h2 still
/// produces roots — real documents do both.
pub(crate) fn build_tree(items: &[(u32, String, usize)]) -> Vec<Node> {
    let mut roots: Vec<Node> = Vec::new();
    // Path of indices from the root down to the current insertion point,
    // paired with the level that produced each step.
    let mut path: Vec<(u32, usize)> = Vec::new();

    for (level, title, page) in items {
        while path.last().is_some_and(|(l, _)| *l >= *level) {
            path.pop();
        }
        let node = Node {
            title: title.clone(),
            page: *page,
            children: Vec::new(),
        };

        let mut cursor = &mut roots;
        for (_, idx) in &path {
            cursor = &mut cursor[*idx].children;
        }
        cursor.push(node);
        path.push((*level, cursor.len() - 1));
    }
    roots
}

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
    for h in headings {
        match super::outline_match::find_heading_page(&page_texts, &h.text, cursor) {
            Some(page) => {
                cursor = page;
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

    // Write beside the target and rename over it. `Document::save` truncates
    // its path before serializing, so saving in place would destroy a PDF the
    // renderer had already produced correctly if anything failed mid-write —
    // and the caller deliberately downgrades an outline failure to a warning,
    // which is only honest while a failure leaves the original intact.
    //
    // Same directory, so the rename is a same-filesystem operation rather than
    // a copy across devices that can itself fail halfway.
    let target = std::path::Path::new(pdf_path);
    let tmp = target.with_extension("outline.tmp");
    doc.save(&tmp).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("save PDF: {e}")
    })?;
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("replace PDF: {e}")
    })?;

    log::info!("[PDF] outline written with {} headings", headings.len());
    Ok(())
}

#[cfg(test)]
#[path = "outline.test.rs"]
mod tests;
