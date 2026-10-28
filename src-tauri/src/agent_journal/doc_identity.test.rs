//! WI-AL1.6 — journal path identity by directory-entry spelling: an
//! existing file is keyed by the name its directory stores (found through
//! the directory, so a hard link keeps its own name), a missing name by its
//! authoritative parent plus the exact requested suffix, and a lookup the
//! filesystem cannot answer is refused instead of guessed.
//!
//! Deterministic regression fixtures on the temp directory's own volume;
//! they do not stand in for native HFS+ or normalization-sensitive
//! verification.
//!
//! Edge cases: `ß`/`SS`/`ẞ`, a zero-width joiner, composed vs decomposed
//! names, two case or Unicode variants a volume keeps apart, hard links
//! under case aliases, an unsearchable folder, a link loop, and a missing
//! parent created later under another spelling.

use std::fs;
use std::path::Path;

use crate::agent_journal::doc_key::{file_id, path_identity_key};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::test_support::tmp;

fn key(p: &Path) -> String {
    format!("path:{}", p.display())
}

fn one_file(a: &Path, b: &Path) -> bool {
    file_id(a).is_some() && file_id(a) == file_id(b)
}

/// Whether the volume reaches `existing` through `alias`, decided only by a
/// lookup that answers: missing is a volume that keeps the names apart, and
/// any other lookup failure fails the test rather than reading as a skip.
fn volume_equates(alias: &Path, existing: &Path) -> bool {
    match fs::metadata(alias) {
        Ok(_) => {
            assert!(one_file(alias, existing), "{alias:?} is another file");
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => panic!("probing {alias:?}: {e}"),
    }
}

/// A missing name is kept exactly: no folding guesses which spellings the
/// volume will treat as one once the file exists.
#[test]
fn missing_names_keep_their_exact_spelling() {
    let dir = tmp();
    for (a, b) in [
        ("new.md", "NEW.md"),
        ("ß.md", "ss.md"),
        ("a\u{200D}.md", "a.md"),
        ("caf\u{e9}.md", "cafe\u{301}.md"),
    ] {
        let (ka, kb) = (
            path_identity_key(&dir.path().join(a)),
            path_identity_key(&dir.path().join(b)),
        );
        assert_ne!(ka, kb, "{a:?} / {b:?}");
        assert!(ka.ends_with(a), "{ka:?} keeps {a:?}");
    }
}

/// An existing file is keyed by its stored spelling, whatever spelling the
/// caller used: never folded, never re-normalized.
#[test]
fn an_existing_file_is_keyed_by_its_stored_spelling() {
    let dir = tmp();
    for (stored, asked) in [
        ("Straße.md", "STRASSE.md"),
        ("ẞig.md", "ssig.md"),
        ("cafe\u{301}.md", "caf\u{e9}.md"),
    ] {
        let made = dir.path().join(stored);
        fs::write(&made, "x").unwrap();
        let other = dir.path().join(asked);
        let k = path_identity_key(&other);
        if volume_equates(&other, &made) {
            assert!(k.ends_with(stored), "{asked:?} -> {k:?}, stored {stored:?}");
            assert_eq!(k, path_identity_key(&made));
        } else {
            assert!(k.ends_with(asked), "{asked:?} is its own name: {k:?}");
        }
    }
    // Where the volume keeps two case or Unicode variants apart, both exist
    // and each is its own document under its own spelling.
    let reg = DocRegistry::default();
    for (a, b) in [("Note.md", "note.md"), ("caf\u{e9}.md", "cafe\u{301}.md")] {
        let dir = tmp();
        let (pa, pb) = (dir.path().join(a), dir.path().join(b));
        fs::write(&pa, "a").unwrap();
        if volume_equates(&pb, &pa) {
            continue; // one entry: the loop above covers it
        }
        fs::write(&pb, "b").unwrap();
        assert!(!one_file(&pa, &pb), "{a:?} / {b:?} are two files");
        let (ka, kb) = (path_identity_key(&pa), path_identity_key(&pb));
        assert!(ka.ends_with(a) && kb.ends_with(b), "{ka:?} / {kb:?}");
        let (da, db) = (
            reg.resolve(&key(&pa)).unwrap(),
            reg.resolve(&key(&pb)).unwrap(),
        );
        assert_ne!(da, db, "{a:?} / {b:?}: two existing variants");
    }
}

/// Two hard links in one folder are two documents, each found by its own
/// spelling, on every platform. On Unix a case alias of either is refused:
/// which link it names could only be learned by writing into the folder,
/// and identity is never guessed. On Windows the volume's own lookup
/// (`FindFirstFileW`) reports the entry the alias reaches, so the alias is
/// that link's document.
#[test]
fn hard_links_keep_their_own_documents_and_a_case_alias_is_refused() {
    let dir = tmp();
    let (alpha, beta) = (dir.path().join("Alpha.md"), dir.path().join("Beta.md"));
    fs::write(&alpha, "x").unwrap();
    fs::hard_link(&alpha, &beta).unwrap();
    let reg = DocRegistry::default();
    let (da, db) = (
        reg.resolve(&key(&alpha)).unwrap(),
        reg.resolve(&key(&beta)).unwrap(),
    );
    assert_ne!(da, db, "hard links are separate documents");
    assert_eq!(reg.resolve(&key(&alpha)).unwrap(), da);
    assert_eq!(reg.resolve(&key(&beta)).unwrap(), db);
    for (asked, own, doc) in [("ALPHA.md", &alpha, da), ("beta.md", &beta, db)] {
        let alias = dir.path().join(asked);
        if !volume_equates(&alias, own) {
            continue; // case-sensitive volume: another name entirely
        }
        let got = reg.resolve(&key(&alias));
        #[cfg(unix)]
        {
            assert!(got.is_err(), "{asked}: {got:?} (not {doc:?})");
            assert!(reg.find(&key(&alias)).is_err(), "{asked}");
        }
        #[cfg(windows)]
        {
            assert_eq!(got.unwrap(), doc, "{asked}: its own link's document");
            assert_eq!(reg.find(&key(&alias)).unwrap(), Some(doc), "{asked}");
        }
    }
}

/// A folder that cannot be searched, or a link loop, is a lookup the
/// filesystem refused: identity is refused too, never guessed from text.
#[cfg(unix)]
#[test]
fn lookup_failures_refuse_instead_of_guessing() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let dir = tmp();
    let locked = dir.path().join("locked");
    fs::create_dir(&locked).unwrap();
    fs::write(locked.join("x.md"), "x").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let probe_blocked = fs::symlink_metadata(locked.join("x.md")).is_err();
    let reg = DocRegistry::default();
    let refused = reg.resolve(&key(&locked.join("x.md")));
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
    if probe_blocked {
        assert!(refused.is_err(), "unsearchable folder: {refused:?}");
    }
    let looped = dir.path().join("loop");
    symlink(&looped, &looped).unwrap();
    let refused = reg.resolve(&key(&looped.join("x.md")));
    assert!(refused.is_err(), "link loop: {refused:?}");
    assert!(reg.find(&key(&looped.join("x.md"))).is_err());
}

/// A document minted while its folder was missing keeps its history once
/// the folder appears under another spelling the volume treats as one,
/// whichever spelling is resolved first, and across a restart.
#[test]
fn a_provisional_document_follows_its_file_into_existence() {
    for stored_first in [false, true] {
        let (docs, journal) = (tmp(), tmp());
        let asked = docs.path().join("Sub").join("new.md");
        let first = {
            let reg = DocRegistry::open(journal.path()).unwrap();
            reg.resolve(&key(&asked)).unwrap()
        };
        fs::create_dir(docs.path().join("sub")).unwrap();
        let stored = docs.path().join("sub").join("new.md");
        fs::write(&stored, "x").unwrap();
        if !volume_equates(&docs.path().join("Sub"), &docs.path().join("sub")) {
            return; // case-sensitive volume: `Sub` is still missing
        }
        let reg = DocRegistry::open(journal.path()).unwrap();
        let order = if stored_first {
            [&stored, &asked]
        } else {
            [&asked, &stored]
        };
        for p in order {
            let got = reg.resolve(&key(p)).unwrap();
            assert_eq!(got, first, "{} (stored first: {stored_first})", p.display());
        }
        drop(reg);
        let reg = DocRegistry::open(journal.path()).unwrap();
        assert_eq!(reg.resolve(&key(&stored)).unwrap(), first, "after restart");
    }
}

/// Two provisional documents under spellings that later prove to be one
/// file are two histories: they are never silently combined, and no third
/// document is minted. Every spelling refuses, whichever is resolved first.
#[test]
fn conflicting_provisional_histories_fail_explicitly() {
    let (docs, journal) = (tmp(), tmp());
    let (one, two) = (
        docs.path().join("Sub").join("new.md"),
        docs.path().join("SUB").join("new.md"),
    );
    let reg = DocRegistry::open(journal.path()).unwrap();
    let (d1, d2) = (
        reg.resolve(&key(&one)).unwrap(),
        reg.resolve(&key(&two)).unwrap(),
    );
    assert_ne!(d1, d2, "two missing spellings are two documents");
    fs::create_dir(docs.path().join("sub")).unwrap();
    let stored = docs.path().join("sub").join("new.md");
    fs::write(&stored, "x").unwrap();
    if !volume_equates(&docs.path().join("SUB"), &docs.path().join("sub")) {
        return;
    }
    for p in [&stored, &one, &two] {
        let refused = reg.resolve(&key(p));
        assert!(refused.is_err(), "{}: {refused:?}", p.display());
        assert!(reg.find(&key(p)).is_err(), "{}", p.display());
    }
}

/// A not-yet-created file under two spellings of one existing folder (a
/// first save, or Save As) has one key exactly when the volume says the
/// two spellings are one folder: the folder's stored spelling comes from
/// the filesystem, the missing name stays as asked.
#[test]
fn a_missing_file_takes_its_existing_folders_stored_spelling() {
    for (made, other) in [
        ("Notes", "NOTES"),
        ("straße", "STRASSE"),
        ("ΟΔΟΣ", "οδοσ"),
        ("k", "\u{212A}"),
        ("ǅ", "ǆ"),
        ("ﬁles", "FILES"),
        ("ẞ", "ss"),
        ("ı", "i"),
        ("笔记", "笔记"),
    ] {
        let root = tmp();
        let a = root.path().join(made);
        fs::create_dir(&a).unwrap();
        let b = root.path().join(other);
        let (ka, kb) = (
            path_identity_key(&a.join("new.md")),
            path_identity_key(&b.join("new.md")),
        );
        assert_eq!(
            ka == kb,
            one_file(&a, &b),
            "{made} / {other}: {ka:?} {kb:?}"
        );
    }
}
