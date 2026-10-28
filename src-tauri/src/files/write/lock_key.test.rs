//! Tests for the write lock's folding: every spelling some volume treats as
//! one file shares a key, on every platform. Over-merging only serializes.
//!
//! Edge cases: multi-scalar case mappings (`ß` ↔ `SS`, `ẞ`, `ﬁ`), Greek
//! final and medial sigma, the Kelvin sign, titlecase digraphs, a dotted
//! capital I, dotless i (NTFS meets it with `I`), the theta symbol, the
//! HFS+ ignorable code points, composed vs decomposed, CJK and emoji, and
//! Windows verbatim and UNC prefixes.

use super::*;

fn same(a: &str, b: &str, windows: bool) -> bool {
    fold(a, windows) == fold(b, windows)
}

#[test]
fn every_platform_folds_the_union_of_its_volumes_rules() {
    for windows in [false, true] {
        for (a, b) in [
            ("/n/straße.md", "/n/STRASSE.md"),
            ("/n/ẞ.md", "/n/ss.md"),
            ("/n/ΟΔΟΣ.md", "/n/οδοσ.md"),
            ("/n/οδος.md", "/n/οδοσ.md"),
            ("/n/\u{212A}.md", "/n/k.md"),
            ("/n/ǅ.md", "/n/ǆ.md"),
            ("/n/ﬁle.md", "/n/FILE.md"),
            ("/n/\u{3d1}.md", "/n/θ.md"),
            ("/Docs/Ä.md", "/docs/ä.md"),
            ("/n/caf\u{e9}.md", "/n/cafe\u{301}.md"),
            ("/n/ı.md", "/n/I.md"),
        ] {
            assert!(same(a, b, windows), "{a} ≡ {b} (windows: {windows})");
        }
        assert!(!same("/n/文档.md", "/n/文件.md", windows));
        assert!(!same("/n/a.md", "/n/b.md", windows));
    }
    assert_eq!(fold("/N/笔记🙂.md", false), "/n/笔记🙂.md");
}

/// HFS+ ignores these code points when comparing names, so a name with one
/// and the name without it are one file there: one lock key.
#[test]
fn hfs_ignorable_code_points_do_not_split_a_lock_key() {
    for c in [
        '\u{200C}', '\u{200D}', '\u{200E}', '\u{202A}', '\u{206F}', '\u{FEFF}',
    ] {
        let with = format!("a{c}.md");
        assert!(same(&with, "a.md", false), "U+{:04X}", c as u32);
        assert!(same(&with, "A.md", true), "U+{:04X}", c as u32);
    }
}

#[test]
fn windows_text_drops_verbatim_prefixes_and_folds() {
    assert_eq!(fold(r"C:\Docs\Note.md", true), r"c:\docs\note.md");
    assert!(same(r"\\?\C:\Docs\Note.md", "C:/docs//note.md/", true));
    assert!(same(
        r"\\?\UNC\server\share\f.md",
        r"\\SERVER\share\f.md",
        true
    ));
}

/// Two spellings of one missing file under one folder share a key on the
/// temp volume whatever its case rules: the lock never relies on a probe.
#[test]
fn spellings_of_a_missing_file_share_a_target_key() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("ß");
    std::fs::create_dir(&dir).unwrap();
    assert_eq!(
        target_key(&dir.join("new.md")),
        target_key(&dir.join("NEW.md"))
    );
    assert_eq!(
        target_key(&dir.join("a\u{200D}.md")),
        target_key(&dir.join("a.md"))
    );
}
