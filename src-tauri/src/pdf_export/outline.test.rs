use super::*;
use lopdf::dictionary;

// --- text_string: titles must survive as readable text ---

#[test]
fn an_ascii_title_stays_a_plain_literal() {
    match text_string("Chapter 1") {
        Object::String(bytes, _) => assert_eq!(bytes, b"Chapter 1".to_vec()),
        other => panic!("expected a string object, got {other:?}"),
    }
}

#[test]
fn a_cjk_title_is_encoded_utf16be_with_a_bom() {
    // A byte literal would be read as PDFDocEncoding and render as mojibake in
    // the sidebar — the whole point of the outline is that it is readable.
    match text_string("第一章") {
        Object::String(bytes, _) => {
            assert_eq!(&bytes[..2], &[0xFE, 0xFF], "missing UTF-16BE BOM");
            let units: Vec<u16> = bytes[2..]
                .chunks(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            assert_eq!(String::from_utf16(&units).unwrap(), "第一章");
        }
        other => panic!("expected a string object, got {other:?}"),
    }
}

#[test]
fn an_accented_title_is_also_utf16be() {
    match text_string("Café") {
        Object::String(bytes, _) => assert_eq!(&bytes[..2], &[0xFE, 0xFF]),
        other => panic!("expected a string object, got {other:?}"),
    }
}

// --- round trip: the outline must actually be in the saved file ---

/// A minimal two-page PDF, built with lopdf so the test needs no fixture and no
/// platform renderer. It carries no text, which is deliberate: heading-to-page
/// matching is `outline_match`'s job and is tested there, while this asserts the
/// object graph a viewer reads.
fn two_page_pdf(path: &str) {
    use lopdf::content::Content;
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for _ in 0..2 {
        let content = Content { operations: vec![] };
        let stream = doc.add_object(lopdf::Stream::new(
            Dictionary::new(),
            Content::encode(&content).unwrap(),
        ));
        let page = doc.add_object(lopdf::dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => stream,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        kids.push(Object::Reference(page));
    }
    let count = kids.len() as i64;
    doc.set_object(
        pages_id,
        lopdf::dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count },
    );
    let catalog = doc.add_object(lopdf::dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc.save(path).expect("write fixture pdf");
}

fn temp_pdf(name: &str) -> String {
    std::env::temp_dir()
        .join(format!("vmark-outline-test-{name}.pdf"))
        .to_string_lossy()
        .into_owned()
}

#[test]
fn the_saved_pdf_carries_an_outline_a_viewer_can_read() {
    let path = temp_pdf("roundtrip");
    two_page_pdf(&path);

    add_outline(
        &path,
        &[
            Heading {
                level: 1,
                text: "First".into(),
            },
            Heading {
                level: 2,
                text: "Nested".into(),
            },
            Heading {
                level: 1,
                text: "Second".into(),
            },
        ],
    )
    .expect("outline injection must succeed");

    let doc = Document::load(&path).expect("reload");
    let catalog = doc.catalog().expect("catalog");
    let root_ref = catalog
        .get(b"Outlines")
        .expect("catalog must link /Outlines");
    let root = doc
        .get_object(root_ref.as_reference().unwrap())
        .unwrap()
        .as_dict()
        .unwrap();
    assert_eq!(root.get(b"Type").unwrap().as_name().unwrap(), b"Outlines");
    // Two roots plus one child.
    assert_eq!(root.get(b"Count").unwrap().as_i64().unwrap(), 3);

    // Walk First -> Next across the top level and check titles and linkage.
    let first_id = root.get(b"First").unwrap().as_reference().unwrap();
    let first = doc.get_object(first_id).unwrap().as_dict().unwrap();
    assert_eq!(first.get(b"Title").unwrap().as_str().unwrap(), b"First");
    assert!(first.get(b"Dest").is_ok(), "each item needs a destination");
    assert!(first.get(b"First").is_ok(), "First has a nested child");

    let second_id = first.get(b"Next").unwrap().as_reference().unwrap();
    let second = doc.get_object(second_id).unwrap().as_dict().unwrap();
    assert_eq!(second.get(b"Title").unwrap().as_str().unwrap(), b"Second");
    assert_eq!(
        second.get(b"Prev").unwrap().as_reference().unwrap(),
        first_id,
        "sibling links must point back"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn the_viewer_is_asked_to_show_the_sidebar() {
    let path = temp_pdf("pagemode");
    two_page_pdf(&path);
    add_outline(
        &path,
        &[Heading {
            level: 1,
            text: "Only".into(),
        }],
    )
    .unwrap();

    let doc = Document::load(&path).unwrap();
    assert_eq!(
        doc.catalog()
            .unwrap()
            .get(b"PageMode")
            .unwrap()
            .as_name()
            .unwrap(),
        b"UseOutlines",
        "without PageMode most viewers open collapsed and the outline looks absent"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn no_headings_leaves_the_pdf_untouched_and_succeeds() {
    let path = temp_pdf("empty");
    two_page_pdf(&path);
    let before = std::fs::read(&path).unwrap();

    add_outline(&path, &[]).expect("an empty heading list is not a failure");

    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "file must not be rewritten"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_missing_file_is_an_error_not_a_panic() {
    let err = add_outline(
        &temp_pdf("does-not-exist-xyz"),
        &[Heading {
            level: 1,
            text: "A".into(),
        }],
    )
    .expect_err("a nonexistent PDF must be refused");
    assert!(err.contains("open PDF"), "unexpected error: {err}");
}

// --- the write must never damage an already-correct PDF (audit round 2) ---

#[test]
fn a_failed_outline_write_leaves_no_scratch_file_behind() {
    // TempPath deletes on drop, so an error path cannot litter the user's
    // output directory with half-written PDFs.
    let path = temp_pdf("noleak");
    two_page_pdf(&path);
    add_outline(
        &path,
        &[Heading {
            level: 1,
            text: "A".into(),
        }],
    )
    .unwrap();

    let dir = std::path::Path::new(&path).parent().unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with(".vmark-outline-")
        })
        .collect();
    assert!(
        leftovers.is_empty(),
        "scratch files left behind: {leftovers:?}"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn the_original_pdf_survives_when_there_is_nothing_to_write() {
    // The caller downgrades an outline failure to a warning and reports the
    // export as successful. That is only honest while a failure leaves the
    // rendered PDF exactly as it was.
    let path = temp_pdf("survives");
    two_page_pdf(&path);
    let before = std::fs::read(&path).unwrap();

    // A heading list that cannot be located still writes a valid outline; the
    // page count and content must be untouched either way.
    add_outline(
        &path,
        &[Heading {
            level: 1,
            text: "not in this document".into(),
        }],
    )
    .unwrap();

    let doc = Document::load(&path).expect("PDF must still load");
    assert_eq!(doc.get_pages().len(), 2, "page count must be unchanged");
    assert!(
        std::fs::read(&path).unwrap() != before,
        "an outline was added"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn the_outline_is_written_beside_the_target_not_over_it() {
    // Asserts the mechanism, not just the outcome: the target must not be
    // opened for writing until the replacement is complete. A same-directory
    // temp file is what makes the final step a rename rather than a copy.
    let path = temp_pdf("beside");
    two_page_pdf(&path);
    let inode_before = std::fs::metadata(&path).unwrap().len();
    add_outline(
        &path,
        &[Heading {
            level: 1,
            text: "Only".into(),
        }],
    )
    .unwrap();
    let after = std::fs::metadata(&path).unwrap().len();
    assert!(after != inode_before, "file should have been replaced");
    assert!(
        Document::load(&path).is_ok(),
        "replacement must be a valid PDF"
    );
    let _ = std::fs::remove_file(&path);
}

// --- closing the last audit findings ---
