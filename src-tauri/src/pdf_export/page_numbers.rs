//! Stamping page numbers onto a finished PDF.
//!
//! Purpose: exported PDFs had no page numbers on any platform. CSS puts them in
//! `@page` margin boxes, which WebKit does not implement — so the setting was
//! never offered rather than working on one platform out of three.
//!
//! Done AFTER the render, on the finished file, for the same reason the outline
//! is: it takes the engines out of the question entirely. One code path, the
//! same bytes on macOS, Windows and Linux, no async pagination to wait for.
//!
//! What to draw and where lives next door in `page_numbers_label.rs`; this file
//! is the document surgery that puts it on the page.
//!
//! @coordinates-with page_numbers_label.rs — the spec, the label, the geometry
//! @coordinates-with pdf_io.rs — the atomic save both post-processors share
//! @coordinates-with commands.rs — calls this after the render and the outline
//! @module pdf_export/page_numbers

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

use super::page_numbers_label::{baseline, escape, render_label, text_width};
// The feature's public vocabulary. Re-exported so callers say
// `page_numbers::PageNumberSpec` rather than reaching into the private half.
pub use super::page_numbers_label::{Format, PageNumberSpec, Position};

/// Stamp page numbers onto an existing PDF, in place.
pub fn stamp_page_numbers(pdf_path: &str, spec: &PageNumberSpec) -> Result<(), String> {
    if spec.position == Position::None {
        return Ok(());
    }

    let mut doc = Document::load(pdf_path).map_err(|e| format!("open PDF: {e}"))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let total = pages.len();
    if total == 0 {
        return Err(rust_i18n::t!("errors.pdf.noPages").to_string());
    }

    // One font object for the whole document rather than one per page.
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });

    // A page's content streams are CONCATENATED into one stream, so anything
    // the renderer left in the graphics state is still in effect when our
    // stamp begins. Both WebView2 and WebKitGTK emit a top-level
    // `1 0 0 -1 0 <height> cm` — a y-flip they never undo — and our own `q`/`Q`
    // does not help, because `q` saves the CURRENT state rather than resetting
    // to the identity CTM. The number then drew at the TOP of the page and
    // mirrored, on two platforms out of three, while every structural check
    // passed and the text still extracted cleanly.
    //
    // Wrapping the ORIGINAL content in its own q/Q discards whatever it leaves,
    // so the stamp starts from the page's default space where (0,0) is the
    // bottom-left corner — which is the space `baseline()` computes in. One
    // pair of streams shared by every page; they are indirect objects, so
    // several Contents arrays may reference them.
    let push_state = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
    let pop_state = doc.add_object(Stream::new(Dictionary::new(), b"Q\n".to_vec()));

    let mut unrenderable = 0usize;
    for (page_no, page_id) in pages {
        let n = page_no as usize;
        if spec.skip_first && n == 1 {
            continue;
        }
        let Some(label) = render_label(spec, n, total) else {
            unrenderable += 1;
            continue;
        };

        let (page_width, _) = page_size(&doc, page_id);
        let width = text_width(&label, spec.font_size_pt);
        let (x, y) = baseline(spec, page_width, width);

        // q/Q around our own drawing too, so the colour and font selection do
        // not leak onto anything appended after us.
        let mut ops = Vec::new();
        ops.extend_from_slice(b"q\nBT\n0 0 0 rg\n/VMarkPageNo ");
        ops.extend_from_slice(format!("{:.2}", spec.font_size_pt).as_bytes());
        ops.extend_from_slice(b" Tf\n");
        ops.extend_from_slice(format!("{x:.2} {y:.2} Td\n").as_bytes());
        ops.push(b'(');
        ops.extend_from_slice(&escape(&label));
        ops.extend_from_slice(b") Tj\nET\nQ\n");

        let stamp_id = doc.add_object(Stream::new(Dictionary::new(), ops));
        append_content(&mut doc, page_id, stamp_id, push_state, pop_state)?;
        add_font_resource(&mut doc, page_id, font_id)?;
    }

    if unrenderable > 0 {
        log::warn!(
            "[PDF] page-number label is not Latin-1 and Helvetica cannot draw it; \
             {unrenderable} page(s) left unnumbered"
        );
    }

    super::pdf_io::save_atomically(&mut doc, pdf_path, ".vmark-pageno-")?;
    log::info!("[PDF] stamped page numbers on {total} page(s)");
    Ok(())
}

/// A page's width and height from its MediaBox, defaulting to A4.
fn page_size(doc: &Document, page_id: ObjectId) -> (f64, f64) {
    let fallback = (595.28, 841.89);
    let Ok(page) = doc.get_object(page_id).and_then(|o| o.as_dict()) else {
        return fallback;
    };
    // MediaBox is an INHERITABLE attribute: a page may carry none and take its
    // parent's. Walking up is not optional — every page produced by these
    // renderers inherits it, so reading only the page would fall back to A4 and
    // silently mis-centre every number on Letter or A5.
    let mut node = page.clone();
    let mut mb = None;
    for _ in 0..32 {
        if let Ok(arr) = node.get(b"MediaBox").and_then(|o| o.as_array()) {
            mb = Some(arr.to_vec());
            break;
        }
        let Ok(parent) = node.get(b"Parent").and_then(|o| o.as_reference()) else {
            break;
        };
        let Ok(next) = doc.get_object(parent).and_then(|o| o.as_dict()) else {
            break;
        };
        node = next.clone();
    }
    let Some(mb) = mb else { return fallback };
    if mb.len() != 4 {
        return fallback;
    }
    let num = |i: usize| {
        mb[i]
            .as_float()
            .map(f64::from)
            .or_else(|_| mb[i].as_i64().map(|v| v as f64))
    };
    match (num(0), num(1), num(2), num(3)) {
        (Ok(x0), Ok(y0), Ok(x1), Ok(y1)) => ((x1 - x0).abs(), (y1 - y0).abs()),
        _ => fallback,
    }
}

/// Append the stamp to a page, with the page's own content fenced off.
///
/// The result is always `[q, <original…>, Q, stamp]`. The fence is not
/// decoration: see `stamp_page_numbers` — without it the stamp inherits the
/// renderer's unbalanced y-flip and draws upside-down at the top of the page.
fn append_content(
    doc: &mut Document,
    page_id: ObjectId,
    stamp: ObjectId,
    push_state: ObjectId,
    pop_state: ObjectId,
) -> Result<(), String> {
    let page = doc
        .get_object_mut(page_id)
        .and_then(|o| o.as_dict_mut())
        .map_err(|e| format!("page dictionary: {e}"))?;
    let mut contents = vec![Object::Reference(push_state)];
    match page.get(b"Contents").cloned() {
        Ok(Object::Array(a)) => contents.extend(a),
        Ok(Object::Reference(r)) => contents.push(Object::Reference(r)),
        // A page with no content at all is still stampable.
        _ => {}
    }
    contents.push(Object::Reference(pop_state));
    contents.push(Object::Reference(stamp));
    page.set("Contents", Object::Array(contents));
    Ok(())
}

/// Walk the page tree for an inherited `/Resources` dictionary.
fn inherited_resources(doc: &Document, page_id: ObjectId) -> Option<Dictionary> {
    let mut node = doc.get_object(page_id).ok()?.as_dict().ok()?.clone();
    for _ in 0..32 {
        match node.get(b"Resources") {
            Ok(Object::Dictionary(d)) => return Some(d.clone()),
            Ok(Object::Reference(r)) => {
                return doc.get_object(*r).ok()?.as_dict().ok().cloned();
            }
            _ => {}
        }
        let parent = node.get(b"Parent").and_then(|o| o.as_reference()).ok()?;
        node = doc.get_object(parent).ok()?.as_dict().ok()?.clone();
    }
    None
}

/// Register the font under `/VMarkPageNo` in the page's resources.
///
/// A distinctive name so it cannot collide with a font the renderer already
/// named `/F1` — which every engine here does.
fn add_font_resource(doc: &mut Document, page_id: ObjectId, font: ObjectId) -> Result<(), String> {
    let existing = doc
        .get_object(page_id)
        .and_then(|o| o.as_dict())
        .ok()
        .and_then(|d| d.get(b"Resources").ok().cloned());

    let mut resources = match existing {
        Some(Object::Dictionary(d)) => d,
        // Resources can be an indirect reference, and can be inherited from the
        // page tree. Either way, give this page its own so the edit cannot
        // reach a dictionary shared with pages we did not stamp.
        Some(Object::Reference(r)) => doc
            .get_object(r)
            .and_then(|o| o.as_dict())
            .cloned()
            .unwrap_or_default(),
        // Inherited from the page tree, or absent entirely.
        _ => inherited_resources(doc, page_id).unwrap_or_default(),
    };

    let mut fonts = match resources.get(b"Font") {
        Ok(Object::Dictionary(d)) => d.clone(),
        Ok(Object::Reference(r)) => doc
            .get_object(*r)
            .and_then(|o| o.as_dict())
            .cloned()
            .unwrap_or_default(),
        _ => Dictionary::new(),
    };
    fonts.set("VMarkPageNo", Object::Reference(font));
    resources.set("Font", Object::Dictionary(fonts));

    let page = doc
        .get_object_mut(page_id)
        .and_then(|o| o.as_dict_mut())
        .map_err(|e| format!("page dictionary: {e}"))?;
    page.set("Resources", Object::Dictionary(resources));
    Ok(())
}

#[cfg(test)]
#[path = "page_numbers.test.rs"]
mod tests;
