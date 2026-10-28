//! WI-AL1.6 — tests for `path_identity.rs`: separator cleanup never folds
//! case or Unicode form, and Windows verbatim prefixes are removed.
//!
//! Edge cases: verbatim and UNC verbatim prefixes, mixed separators,
//! repeated and trailing separators, roots, composed vs decomposed, case.

use super::*;

#[test]
fn windows_separators_and_verbatim_prefixes_clean_up_to_one_text() {
    let want = r"C:\Docs\Note.md";
    for raw in [
        r"\\?\C:\Docs\Note.md",
        "C:/Docs/Note.md",
        r"C:\Docs\\Note.md\",
    ] {
        assert_eq!(path_text(raw, true), want, "{raw}");
    }
    assert_eq!(path_text(r"C:\", true), r"C:\");
}

#[test]
fn a_windows_verbatim_unc_prefix_becomes_a_unc_path_never_a_relative_one() {
    let text = path_text(r"\\?\UNC\server\share\file.md", true);
    assert_eq!(text, r"\\server\share\file.md");
}

#[test]
fn path_text_keeps_case_and_unicode_form_exactly() {
    assert_eq!(path_text("/docs//A.md/", false), "/docs/A.md");
    assert_eq!(path_text("/", false), "/");
    assert_ne!(
        path_text("/Docs/A.md", false),
        path_text("/docs/a.md", false)
    );
    assert_ne!(
        path_text("/caf\u{e9}.md", false),
        path_text("/cafe\u{301}.md", false)
    );
    assert_ne!(
        path_text(r"C:\Note.md", true),
        path_text(r"c:\note.md", true)
    );
    // Windows cleanup keeps each Unicode form exactly, too.
    for raw in ["C:\\caf\u{e9}.md", "C:\\cafe\u{301}.md"] {
        assert_eq!(path_text(raw, true), raw, "{raw:?}");
        assert_eq!(path_text(&raw.replace('\\', "/"), true), raw, "{raw:?}");
    }
    assert_ne!(
        path_text("C:/Docs/caf\u{e9}.md", true),
        path_text("C:/Docs/cafe\u{301}.md", true)
    );
}
