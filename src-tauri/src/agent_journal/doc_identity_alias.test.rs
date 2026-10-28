//! WI-AL1.6 — journal path identity at its edges: which provisional
//! history an existing entry inherits, and which spellings name which
//! entry, decided by the filesystem rather than by the text of the request.
//!
//! Edge cases: `..` after a symlinked folder, a dangling link whose
//! target's folder is missing, a leaf replaced by a link while its folder
//! is listed, a case alias of several hard links (refused on Unix, its
//! reached entry on Windows; nothing written), a provisional alias
//! resolved through the stored spelling first, and Save As onto a file a
//! provisional alias names.
//!
//! Deterministic fixtures on the temp directory's own volume; a case that
//! needs a case-insensitive volume returns early on a case-sensitive one,
//! and only there: any other probe failure fails the test.

use std::fs;
use std::path::Path;

use crate::agent_journal::doc_key::file_id;
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

/// `link/..` is the link target's parent, as the OS resolves it: a
/// provisional history at the lexical spelling (`n/x.md`) is another
/// file's, and does not move to `other/x.md`.
#[cfg(unix)]
#[test]
fn dot_dot_after_a_symlink_never_inherits_an_unrelated_history() {
    let (n, other, journal) = (tmp(), tmp(), tmp());
    let x = n.path().join("x.md");
    let reg = DocRegistry::open(journal.path()).unwrap();
    let d1 = reg.resolve(&key(&x)).unwrap();
    fs::create_dir(other.path().join("child")).unwrap();
    std::os::unix::fs::symlink(other.path().join("child"), n.path().join("link")).unwrap();
    let real = other.path().join("x.md");
    fs::write(&real, "o").unwrap();
    let via = n.path().join("link").join("..").join("x.md");
    let d = reg.resolve(&key(&via)).unwrap();
    assert_ne!(d, d1, "an unrelated file took x.md's provisional history");
    assert_eq!(reg.resolve(&key(&real)).unwrap(), d);
    assert_eq!(reg.resolve(&key(&x)).unwrap(), d1, "x.md keeps its own");
    drop(reg);
    let reg = DocRegistry::open(journal.path()).unwrap();
    assert_eq!(reg.resolve(&key(&x)).unwrap(), d1, "after restart");
    assert_eq!(reg.resolve(&key(&via)).unwrap(), d, "after restart");
}

/// A dangling link whose target's folder is missing is its target,
/// provisionally: once the target exists, the link still finds the
/// document it had.
#[cfg(unix)]
#[test]
fn a_dangling_link_into_a_missing_folder_keeps_its_document() {
    let (docs, journal) = (tmp(), tmp());
    let target = docs.path().join("missing").join("a.md");
    let link = docs.path().join("alias.md");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let reg = DocRegistry::open(journal.path()).unwrap();
    let d1 = reg.resolve(&key(&link)).unwrap();
    assert_eq!(
        reg.resolve(&key(&target)).unwrap(),
        d1,
        "the link is its target"
    );
    fs::create_dir(docs.path().join("missing")).unwrap();
    fs::write(&target, "x").unwrap();
    assert_eq!(reg.resolve(&key(&link)).unwrap(), d1, "after creation");
    assert_eq!(reg.resolve(&key(&target)).unwrap(), d1);
    drop(reg);
    let reg = DocRegistry::open(journal.path()).unwrap();
    assert_eq!(reg.resolve(&key(&link)).unwrap(), d1, "after restart");
}

/// A leaf replaced by a link (to another indexed file) while its folder is
/// listed is refused, even when the listing holds its exact name: the
/// replacement never takes a key it does not hold.
#[cfg(unix)]
#[test]
fn a_leaf_replaced_during_the_listing_is_refused() {
    use crate::files::entry_spelling::BEFORE_LISTING;
    let docs = tmp();
    let (a, b) = (docs.path().join("a.md"), docs.path().join("b.md"));
    fs::write(&a, "a").unwrap();
    fs::write(&b, "b").unwrap();
    let reg = DocRegistry::default();
    let db = reg.resolve(&key(&b)).unwrap();
    let (swap_a, swap_b) = (a.clone(), b.clone());
    BEFORE_LISTING.with(|h| {
        *h.borrow_mut() = Some(Box::new(move || {
            fs::remove_file(&swap_a).unwrap();
            std::os::unix::fs::symlink(&swap_b, &swap_a).unwrap();
        }));
    });
    let racing = reg.resolve(&key(&a));
    assert!(BEFORE_LISTING.with(|h| h.borrow().is_none()), "hook ran");
    assert!(racing.is_err(), "replaced while probed: {racing:?}");
    assert_eq!(reg.resolve(&key(&a)).unwrap(), db, "now a link to b.md");
}

/// A leaf replaced by a link after its links were followed (it was a plain
/// file then) is refused: it never keeps the key of the path it no longer
/// is, so no spelling gets one document now and another on the next look.
#[cfg(unix)]
#[test]
fn a_leaf_replaced_after_its_links_were_followed_is_refused() {
    use crate::files::entry_spelling::AFTER_FOLLOW;
    let docs = tmp();
    let (a, b) = (docs.path().join("a.md"), docs.path().join("b.md"));
    fs::write(&a, "a").unwrap();
    fs::write(&b, "b").unwrap();
    let reg = DocRegistry::default();
    let db = reg.resolve(&key(&b)).unwrap();
    let (swap_a, swap_b) = (a.clone(), b.clone());
    AFTER_FOLLOW.with(|h| {
        *h.borrow_mut() = Some(Box::new(move || {
            fs::remove_file(&swap_a).unwrap();
            std::os::unix::fs::symlink(&swap_b, &swap_a).unwrap();
        }));
    });
    let racing = reg.resolve(&key(&a));
    assert!(AFTER_FOLLOW.with(|h| h.borrow().is_none()), "hook ran");
    assert!(racing.is_err(), "replaced after following: {racing:?}");
    assert_eq!(reg.resolve(&key(&a)).unwrap(), db, "now a link to b.md");
}

/// Hard links in one folder that a case alias could name (their names
/// differ by an ignorable joiner, dotless i, or `ß`) are refused for that
/// alias on Unix: telling them apart would mean writing names into the
/// folder. On Windows the volume's own lookup (`FindFirstFileW`) reports
/// the entry the alias reaches, so the alias stays that link's document.
/// Everywhere, each link's own spelling resolves to its own document, the
/// same alias of a single file resolves to it, and nothing is written.
#[test]
fn a_case_alias_of_several_hard_links_is_refused_without_writing() {
    for (matched, other, asked) in [
        ("a.md", "a\u{200D}.md", "A.md"),
        ("i.md", "\u{131}.md", "I.md"),
        ("ss.md", "\u{df}.md", "SS.md"),
    ] {
        let dir = tmp();
        let (m, o) = (dir.path().join(matched), dir.path().join(other));
        fs::write(&m, "x").unwrap();
        let req = dir.path().join(asked);
        if !volume_equates(&req, &m) {
            continue; // case-sensitive volume: another name entirely
        }
        let reg = DocRegistry::default();
        let single = reg.resolve(&key(&m)).unwrap();
        assert_eq!(
            reg.resolve(&key(&req)).unwrap(),
            single,
            "{asked:?}, one link"
        );
        match fs::hard_link(&m, &o) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                assert!(volume_equates(&o, &m), "{other:?}: {e}");
                continue; // the volume equates the two names: one entry
            }
            Err(e) if e.kind() == std::io::ErrorKind::Unsupported => {
                continue; // the volume has no hard links
            }
            Err(e) => panic!("hard link {other:?}: {e}"),
        }
        let dother = reg.resolve(&key(&o)).unwrap();
        assert_ne!(single, dother, "{matched:?} / {other:?}: hard links");
        assert_eq!(reg.resolve(&key(&m)).unwrap(), single, "{matched:?} exact");
        let got = reg.resolve(&key(&req));
        #[cfg(unix)]
        assert!(
            matches!(&got, Err(e) if e.to_string().contains("several directory entries")),
            "{asked:?}: {got:?}"
        );
        #[cfg(windows)]
        assert_eq!(got.unwrap(), single, "{asked:?}: the entry it reaches");
        let listed: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(listed.len(), 2, "nothing written beside the links");
    }
}

/// A provisional history follows its file into existence whichever
/// spelling is resolved first: the stored spelling first, then the alias.
#[test]
fn a_provisional_alias_is_found_when_the_stored_spelling_comes_first() {
    let (docs, journal) = (tmp(), tmp());
    let asked = docs.path().join("NEW.md");
    let first = DocRegistry::open(journal.path())
        .unwrap()
        .resolve(&key(&asked))
        .unwrap();
    let stored = docs.path().join("new.md");
    fs::write(&stored, "x").unwrap();
    if !volume_equates(&asked, &stored) {
        return; // case-sensitive volume: NEW.md is still missing
    }
    let reg = DocRegistry::open(journal.path()).unwrap();
    assert_eq!(reg.resolve(&key(&stored)).unwrap(), first, "stored first");
    assert_eq!(reg.resolve(&key(&asked)).unwrap(), first, "then the alias");
    drop(reg);
    let reg = DocRegistry::open(journal.path()).unwrap();
    assert_eq!(reg.resolve(&key(&asked)).unwrap(), first, "after restart");
}

/// Save As onto an existing file takes over the provisional histories its
/// other spellings recorded while it was missing: the destination is
/// replaced whole, so a later lookup by that spelling finds the bound
/// document, not a conflict.
#[test]
fn save_as_replaces_the_destinations_provisional_aliases() {
    let (docs, journal) = (tmp(), tmp());
    let asked = docs.path().join("NEW.md");
    let reg = DocRegistry::open(journal.path()).unwrap();
    let old = reg.resolve(&key(&asked)).unwrap();
    let stored = docs.path().join("new.md");
    fs::write(&stored, "x").unwrap();
    if !volume_equates(&asked, &stored) {
        return;
    }
    let tab = reg.resolve("tab:w/1").unwrap();
    assert_eq!(reg.bind("tab:w/1", &key(&asked)).unwrap(), tab);
    assert_ne!(tab, old);
    assert_eq!(reg.resolve(&key(&asked)).unwrap(), tab, "the alias");
    assert_eq!(
        reg.resolve(&key(&stored)).unwrap(),
        tab,
        "the stored spelling"
    );
    drop(reg);
    let reg = DocRegistry::open(journal.path()).unwrap();
    assert_eq!(reg.resolve(&key(&asked)).unwrap(), tab, "after restart");
}
