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
    use lopdf::content::Content;
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for _ in 0..pages {
        let stream = doc.add_object(Stream::new(
            Dictionary::new(),
            Content::encode(&Content { operations: vec![] }).unwrap(),
        ));
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
    let (w, h) = page_size(&doc, page_id);
    assert!(
        (w - 595.0).abs() < 0.01 && (h - 842.0).abs() < 0.01,
        "got {w}x{h}"
    );
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
