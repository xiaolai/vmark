use super::*;

fn spec(position: Position, format: Format) -> PageNumberSpec {
    PageNumberSpec {
        position,
        format,
        skip_first: false,
        font_size_pt: 9.0,
        bottom_margin_pt: 72.0,
        side_margin_pt: 72.0,
        verbose_template: "Page {n} of {total}".to_string(),
        ink_rgb: Default::default(),
    }
}

fn test_dir(name: &str) -> std::path::PathBuf {
    // Per-test directory: these run in parallel and the assertions below read
    // the directory, so a shared temp dir would see a sibling's scratch file.
    let d = std::env::temp_dir().join(format!("vmark-pageno-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&d).expect("create test dir");
    d
}

fn blank_pdf(path: &std::path::Path, pages: usize) {
    content_pdf(path, pages, b"")
}

/// A fixture whose pages carry `body` as their content stream.
///
/// `body` is raw operators rather than an encoded `Content`, because the case
/// that matters is an UNBALANCED graphics state — which a well-formed operation
/// list is awkward to express and which every real renderer here produces.
fn content_pdf(path: &std::path::Path, pages: usize, body: &[u8]) {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for _ in 0..pages {
        let stream = doc.add_object(Stream::new(Dictionary::new(), body.to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => stream,
        });
        kids.push(Object::Reference(page));
    }
    let count = kids.len() as i64;
    doc.set_object(
        pages_id,
        // MediaBox lives on the PAGES node, not the page — the inheritable case
        // every one of these renderers actually produces.
        dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        },
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc.save(path).expect("write fixture");
}

/// The visible text of a page, from its content streams.
fn page_text(doc: &Document, page_id: ObjectId) -> String {
    let bytes = doc.get_page_content(page_id);
    String::from_utf8_lossy(&bytes).into_owned()
}

#[test]
fn the_renderers_unbalanced_flip_cannot_reach_the_stamp() {
    // THE REGRESSION THIS FILE EXISTS FOR. Content streams are concatenated,
    // so a top-level `cm` the renderer never undoes is still in effect when the
    // stamp begins — and `q` saves the CURRENT state rather than resetting to
    // identity, so wrapping only our own drawing does nothing. Both WebView2
    // and WebKitGTK emit exactly this y-flip: the number drew at the TOP of the
    // page, mirrored, on two platforms out of three, while the label was
    // present, the font was registered, and the text extracted cleanly.
    //
    // The fix fences the page's own content in q/Q. Assert the shape, because
    // it is the shape that makes the coordinates mean what `baseline()` says.
    let dir = test_dir("flipctm");
    let path = dir.join("doc.pdf");
    content_pdf(&path, 2, b"1 0 0 -1 0 842 cm\n");
    stamp_page_numbers(
        &path.to_string_lossy(),
        &spec(Position::BottomCenter, Format::Plain),
    )
    .unwrap();

    let doc = Document::load(&path).unwrap();
    for (_, page_id) in doc.get_pages() {
        let Ok(Object::Array(contents)) = doc
            .get_object(page_id)
            .and_then(|o| o.as_dict())
            .and_then(|d| d.get(b"Contents"))
        else {
            panic!("Contents must be an array after stamping");
        };
        let stream = |i: usize| -> Vec<u8> {
            let Object::Reference(r) = contents[i] else {
                panic!("Contents entries must be references")
            };
            doc.get_object(r)
                .and_then(|o| o.as_stream())
                .map(|s| s.content.clone())
                .unwrap_or_default()
        };
        assert_eq!(contents.len(), 4, "expected [q, original, Q, stamp]");
        assert_eq!(stream(0), b"q\n".to_vec(), "must push before page content");
        assert!(
            String::from_utf8_lossy(&stream(1)).contains("cm"),
            "the original content must survive untouched"
        );
        assert_eq!(stream(2), b"Q\n".to_vec(), "must pop before the stamp");
        assert!(
            String::from_utf8_lossy(&stream(3)).contains("/VMarkPageNo"),
            "the stamp comes last"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn every_page_is_stamped_and_the_pdf_still_loads() {
    let dir = test_dir("stamped");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 3);

    stamp_page_numbers(
        &path.to_string_lossy(),
        &spec(Position::BottomCenter, Format::WithTotal),
    )
    .expect("stamping must succeed");

    let doc = Document::load(&path).expect("still a valid PDF");
    let pages: Vec<_> = doc.get_pages().into_iter().collect();
    assert_eq!(pages.len(), 3);
    for (n, (_, id)) in pages.iter().enumerate() {
        let text = page_text(&doc, *id);
        assert!(
            text.contains(&format!("({} / 3)", n + 1)),
            "page {} text: {text}",
            n + 1
        );
        assert!(text.contains("/VMarkPageNo"), "font must be selected");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn skip_first_leaves_the_title_page_unnumbered() {
    let dir = test_dir("skipfirst");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 3);
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.skip_first = true;
    stamp_page_numbers(&path.to_string_lossy(), &s).unwrap();

    let doc = Document::load(&path).unwrap();
    let pages: Vec<_> = doc.get_pages().into_iter().collect();
    assert!(
        !page_text(&doc, pages[0].1).contains("Tj"),
        "page 1 must be untouched"
    );
    assert!(page_text(&doc, pages[1].1).contains("(2)"));
    // The numbering keeps the real page number, not a re-based one — a reader
    // matching the sidebar against the footer expects them to agree.
    assert!(page_text(&doc, pages[2].1).contains("(3)"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_ink_colour_reaches_the_content_stream() {
    // Black on a dark-theme export is invisible, so the frontend sends the ink
    // it wants. A hardcoded `0 0 0 rg` would pass every other test here.
    let dir = test_dir("ink");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 1);
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.ink_rgb = InkRgb([0.78, 0.78, 0.78]);
    stamp_page_numbers(&path.to_string_lossy(), &s).unwrap();

    let doc = Document::load(&path).unwrap();
    let (_, page_id) = doc.get_pages().into_iter().next().unwrap();
    let text = page_text(&doc, page_id);
    assert!(text.contains("0.780 0.780 0.780 rg"), "got: {text}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_mediabox_with_a_non_zero_origin_still_lands_on_the_paper() {
    // A cropped or imposed PDF can start at e.g. [20 20 615 862]. Ignoring the
    // origin shifts the number off both edges — and off the sheet entirely once
    // the origin exceeds the margin.
    let dir = test_dir("origin");
    let path = dir.join("doc.pdf");
    offset_pdf(&path, 100.0);
    stamp_page_numbers(
        &path.to_string_lossy(),
        &spec(Position::BottomCenter, Format::Plain),
    )
    .unwrap();

    let doc = Document::load(&path).unwrap();
    let (_, page_id) = doc.get_pages().into_iter().next().unwrap();
    let text = page_text(&doc, page_id);
    let td = text
        .lines()
        .find(|l| l.ends_with(" Td"))
        .expect("a Td line must exist");
    let coords: Vec<f64> = td
        .split_whitespace()
        .take(2)
        .map(|t| t.parse().unwrap())
        .collect();
    assert!(
        coords[0] >= 100.0 && coords[1] >= 100.0,
        "baseline {coords:?} must be inside a box starting at (100,100)"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A one-page fixture whose MediaBox starts at `(offset, offset)`.
fn offset_pdf(path: &std::path::Path, offset: f64) {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let stream = doc.add_object(Stream::new(Dictionary::new(), Vec::new()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Contents" => stream,
    });
    doc.set_object(
        pages_id,
        dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page)],
            "Count" => 1_i64,
            "MediaBox" => vec![
                offset.into(), offset.into(),
                (offset + 595.0).into(), (offset + 842.0).into(),
            ],
        },
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc.save(path).expect("write fixture");
}

#[test]
fn position_none_leaves_the_file_byte_identical() {
    let dir = test_dir("none");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 2);
    let before = std::fs::read(&path).unwrap();
    stamp_page_numbers(
        &path.to_string_lossy(),
        &spec(Position::None, Format::Plain),
    )
    .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_inherited_mediabox_is_found_rather_than_defaulted() {
    // The fixture puts MediaBox on the Pages node, which is what these
    // renderers emit. Reading only the page would silently fall back to A4 and
    // mis-centre every number on any other paper size.
    let dir = test_dir("inherited");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 1);
    let doc = Document::load(&path).unwrap();
    let (_, page_id) = doc.get_pages().into_iter().next().unwrap();
    let (x0, y0, w, h) = page_box(&doc, page_id);
    assert!(
        (w - 595.0).abs() < 0.01 && (h - 842.0).abs() < 0.01,
        "got {w}x{h}"
    );
    assert_eq!((x0, y0), (0.0, 0.0), "this fixture starts at the origin");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stamping_leaves_no_scratch_file_behind() {
    let dir = test_dir("noleak");
    let path = dir.join("doc.pdf");
    blank_pdf(&path, 2);
    stamp_page_numbers(
        &path.to_string_lossy(),
        &spec(Position::BottomCenter, Format::Plain),
    )
    .unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(".vmark-"))
        .collect();
    assert!(leftovers.is_empty(), "scratch left: {leftovers:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_file_is_an_error_not_a_panic() {
    let dir = test_dir("missing");
    let err = stamp_page_numbers(
        &dir.join("nope.pdf").to_string_lossy(),
        &spec(Position::BottomCenter, Format::Plain),
    )
    .expect_err("a nonexistent PDF must be refused");
    assert!(err.contains("open PDF"), "unexpected: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}
