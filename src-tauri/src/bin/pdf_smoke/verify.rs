//! PDF artifact verification for the smoke harness.
//!
//! Purpose: split from `main.rs` to stay under the size limit, and because
//! this is the part that decides pass/fail — it reads the produced PDF rather
//! than trusting the renderer's return value.
//!
//! A backend that ignores `PageSpec` still returns `Ok` and still writes a
//! valid `%PDF`, just at the platform default size. That is why every check
//! here extracts the MediaBox instead of asserting on magic bytes.
//!
//! @coordinates-with main.rs — the only consumer
//! @module bin/pdf_smoke/verify

use std::path::Path;

/// Verify the artifact, not the return value. Page size is extracted from the
/// PDF because a backend that ignores `PageSpec` still returns `Ok`.
pub fn check(
    name: &str,
    result: Result<(), String>,
    path: &Path,
    expect_pt: Option<(u32, u32)>,
) -> usize {
    if let Err(e) = result {
        println!("SMOKE {name} FAIL render error: {e}");
        return 1;
    }
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            println!("SMOKE {name} FAIL no artifact: {e}");
            return 1;
        }
    };
    if !bytes.starts_with(b"%PDF") {
        println!("SMOKE {name} FAIL not a PDF ({} bytes)", bytes.len());
        return 1;
    }
    let pages = count(&bytes, b"/Type /Page").max(count(&bytes, b"/Type/Page"));
    let size = media_box(&bytes);
    match (expect_pt, size) {
        (Some((w, h)), Some((gw, gh))) if gw.abs_diff(w) <= 2 && gh.abs_diff(h) <= 2 => {
            println!(
                "SMOKE {name} PASS {} bytes, pages~{pages}, {gw}x{gh}pt",
                bytes.len()
            );
            0
        }
        (Some((w, h)), Some((gw, gh))) => {
            println!("SMOKE {name} FAIL page size {gw}x{gh}pt, expected {w}x{h}pt");
            1
        }
        (Some(_), None) => {
            println!("SMOKE {name} FAIL no MediaBox found");
            1
        }
        (None, _) => {
            println!("SMOKE {name} PASS {} bytes", bytes.len());
            0
        }
    }
}

/// Verify the page numbers actually landed on the pages, the right way up.
///
/// Reads the content streams rather than trusting `stamp_page_numbers`' return:
/// the stamp writes an extra content stream and a font resource per page, and a
/// PDF that dropped either still loads, still has the right MediaBox, and shows
/// nothing in the footer. That is precisely the failure a human skimming an
/// artifact does not notice on page 14 of 20.
///
/// PRESENCE IS NOT ENOUGH, and this function learned that the hard way: it
/// passed on Windows and Linux while the number was drawing at the top of the
/// page and mirrored, because the renderer's unbalanced y-flip was still in
/// effect. So it also checks the fence — the page's own content wrapped in q/Q
/// before the stamp — which is what makes the coordinates mean what
/// `baseline()` computed.
///
/// Returns the failure count, and prints the counts so the three platforms'
/// transcripts can be diffed directly.
pub fn check_stamped(name: &str, path: &Path, skip_first: bool) -> usize {
    let doc = match lopdf::Document::load(path) {
        Ok(d) => d,
        Err(e) => {
            println!("SMOKE {name} pageno FAIL cannot reload: {e}");
            return 1;
        }
    };
    let pages: Vec<_> = doc.get_pages().into_iter().collect();
    let total = pages.len();
    let mut stamped = 0usize;
    let mut unfenced = 0usize;
    for (_, id) in &pages {
        let content = doc.get_page_content(*id);
        // The font name is distinctive, so this cannot match a renderer's own
        // /F1 — see add_font_resource.
        if count(&content, b"/VMarkPageNo") == 0 {
            continue;
        }
        stamped += 1;
        if !fenced(&doc, *id) {
            unfenced += 1;
        }
    }
    let expected = total.saturating_sub(usize::from(skip_first));
    if total > 0 && stamped == expected && unfenced == 0 {
        println!("SMOKE {name} pageno PASS {stamped}/{total} pages stamped, all fenced");
        0
    } else {
        println!(
            "SMOKE {name} pageno FAIL {stamped}/{total} stamped (expected {expected}), \
             {unfenced} drawn in the renderer's leftover graphics state"
        );
        1
    }
}

/// Is this page's own content fenced off from the stamp?
///
/// The array must be `[q, original…, Q, stamp]`: anything else means the stamp
/// inherits whatever CTM the renderer left behind.
fn fenced(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> bool {
    let Ok(lopdf::Object::Array(contents)) = doc
        .get_object(page_id)
        .and_then(|o| o.as_dict())
        .and_then(|d| d.get(b"Contents"))
    else {
        return false;
    };
    let body_of = |o: &lopdf::Object| -> Vec<u8> {
        match o {
            lopdf::Object::Reference(r) => doc
                .get_object(*r)
                .and_then(|o| o.as_stream())
                .map(|s| s.content.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    };
    let Some(first) = contents.first() else {
        return false;
    };
    let Some(stamp_at) = contents
        .iter()
        .position(|o| count(&body_of(o), b"/VMarkPageNo") > 0)
    else {
        return false;
    };
    body_of(first).trim_ascii() == b"q"
        && stamp_at > 0
        && body_of(&contents[stamp_at - 1]).trim_ascii() == b"Q"
}

pub fn count(hay: &[u8], needle: &[u8]) -> usize {
    hay.windows(needle.len()).filter(|w| *w == needle).count()
}

/// First `/MediaBox [a b c d]`, rounded to whole points.
pub fn media_box(bytes: &[u8]) -> Option<(u32, u32)> {
    let tag = b"/MediaBox";
    let at = bytes.windows(tag.len()).position(|w| w == tag)?;
    let open = bytes[at..].iter().position(|&c| c == b'[')? + at + 1;
    let close = bytes[open..].iter().position(|&c| c == b']')? + open;
    let text = std::str::from_utf8(&bytes[open..close]).ok()?;
    let v: Vec<f64> = text
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if v.len() != 4 {
        return None;
    }
    Some((
        ((v[2] - v[0]).round()) as u32,
        ((v[3] - v[1]).round()) as u32,
    ))
}
