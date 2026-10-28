//! WI-AL1.6 — document identity lifecycle (ADR-AL7): a path's document
//! survives reopen, Save As, in-app rename and an external rename with an
//! unchanged file identity; a copy, a hard link or an identity mismatch is a
//! new document.

use std::fs;
use std::path::{Path, PathBuf};

use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::test_support::tmp;

fn key(p: &Path) -> String {
    format!("path:{}", p.display())
}

fn file(dir: &Path, name: &str, text: &str) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, text).expect("write");
    p
}

fn registry(journal: &Path) -> DocRegistry {
    DocRegistry::open(journal).expect("open identity index")
}

#[test]
fn reopen_gets_the_path_document_back() {
    let (journal, docs) = (tmp(), tmp());
    let a = file(docs.path(), "a.md", "x");
    let first = registry(journal.path()).resolve(&key(&a)).unwrap();
    let again = registry(journal.path()).resolve(&key(&a)).unwrap();
    assert_eq!(first, again, "a reopened path adopts its document");
    let b = file(docs.path(), "b.md", "x");
    assert_ne!(
        registry(journal.path()).resolve(&key(&b)).unwrap(),
        first,
        "identical content is another document"
    );
}

#[test]
fn untitled_save_as_then_rename_then_reopen_keeps_one_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let untitled = reg.resolve("tab:main/t1").unwrap();
    let a = file(docs.path(), "a.md", "draft");
    assert_eq!(
        reg.bind("tab:main/t1", &key(&a)).unwrap(),
        untitled,
        "save as carries the document"
    );
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    assert_eq!(
        reg.bind(&key(&a), &key(&b)).unwrap(),
        untitled,
        "in-app rename carries it"
    );
    drop(reg);
    let reg = registry(journal.path());
    assert_eq!(
        reg.resolve(&key(&b)).unwrap(),
        untitled,
        "close and reopen keeps one document"
    );
    let a = file(docs.path(), "a.md", "new file at the old name");
    assert_ne!(
        reg.resolve(&key(&a)).unwrap(),
        untitled,
        "the old name is a new document"
    );
}

#[test]
fn a_late_resolve_of_the_untitled_key_follows_its_save_as() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let doc = reg.resolve("tab:main/t1").unwrap();
    let a = file(docs.path(), "a.md", "x");
    reg.bind("tab:main/t1", &key(&a)).unwrap();
    assert_eq!(
        reg.resolve("tab:main/t1").unwrap(),
        doc,
        "an epoch closed late lands on the same document"
    );
}

#[test]
fn save_as_over_an_existing_file_does_not_adopt_its_document_and_rebinding_is_idempotent() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let x = file(docs.path(), "x.md", "old");
    let old = reg.resolve(&key(&x)).unwrap();
    let carried = reg.bind("tab:main/fresh", &key(&x)).unwrap();
    assert_ne!(
        carried, old,
        "an untouched tab saved over a file is its own document"
    );
    assert_eq!(
        reg.bind("tab:main/fresh", &key(&x)).unwrap(),
        carried,
        "a duplicate bind is a no-op"
    );
    assert_eq!(reg.resolve(&key(&x)).unwrap(), carried);
}

#[test]
fn external_rename_with_the_same_file_identity_keeps_the_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    assert_eq!(reg.note_renames(&[a.clone(), b.clone()]), 1);
    assert_eq!(reg.resolve(&key(&b)).unwrap(), doc, "paired rename event");
    assert_eq!(
        reg.bind(&key(&a), &key(&b)).unwrap(),
        doc,
        "a tab following the rename binds idempotently"
    );
    let c = docs.path().join("c.md");
    fs::rename(&b, &c).unwrap();
    assert_eq!(
        reg.note_renames(std::slice::from_ref(&c)),
        1,
        "a lone destination endpoint"
    );
    assert_eq!(
        registry(journal.path()).resolve(&key(&c)).unwrap(),
        doc,
        "durable across reopen"
    );
}

#[test]
fn an_external_rename_chain_finished_before_the_batch_keeps_the_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let (b, c) = (docs.path().join("b.md"), docs.path().join("c.md"));
    fs::rename(&a, &b).unwrap();
    fs::rename(&b, &c).unwrap();
    reg.note_renames(&[a, b.clone(), b, c.clone()]);
    assert_eq!(reg.resolve(&key(&c)).unwrap(), doc);
}

#[test]
fn an_externally_renamed_directory_carries_its_indexed_files() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let old = docs.path().join("notes");
    fs::create_dir(&old).unwrap();
    let a = file(&old, "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let new = docs.path().join("archive");
    fs::rename(&old, &new).unwrap();
    reg.note_renames(&[old, new.clone()]);
    assert_eq!(reg.resolve(&key(&new.join("a.md"))).unwrap(), doc);
}

#[test]
fn a_copy_is_a_new_document_even_with_a_rename_event() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let copied = docs.path().join("copy.md");
    fs::copy(&a, &copied).unwrap();
    assert_eq!(reg.note_renames(std::slice::from_ref(&copied)), 0);
    assert_ne!(reg.resolve(&key(&copied)).unwrap(), doc);
    assert_eq!(
        reg.resolve(&key(&a)).unwrap(),
        doc,
        "the original keeps its document"
    );
}

#[cfg(unix)]
#[test]
fn a_hard_link_is_a_separate_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let linked = docs.path().join("linked.md");
    fs::hard_link(&a, &linked).unwrap();
    assert_eq!(
        reg.note_renames(std::slice::from_ref(&linked)),
        0,
        "the original path still holds the identity"
    );
    assert_ne!(reg.resolve(&key(&linked)).unwrap(), doc);
}

/// VMark saves by temp file and rename, so a save changes the file identity.
fn replace(p: &Path, text: &str) {
    let tmp_file = p.with_extension("tmp");
    fs::write(&tmp_file, text).unwrap();
    fs::rename(&tmp_file, p).unwrap();
}

#[test]
fn an_internal_save_refreshes_the_file_identity_an_external_rename_is_checked_against() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    replace(&a, "saved by VMark");
    reg.note_saved(&key(&a));
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    reg.note_renames(&[a, b.clone()]);
    assert_eq!(reg.resolve(&key(&b)).unwrap(), doc);
}

#[test]
fn an_identity_mismatch_on_rename_is_a_new_document_but_a_same_path_replacement_is_not() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    replace(&a, "another editor saved it");
    assert_eq!(
        reg.resolve(&key(&a)).unwrap(),
        doc,
        "the path keeps its document"
    );
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    assert_eq!(
        reg.note_renames(&[a, b.clone()]),
        0,
        "the recorded identity no longer matches"
    );
    assert_ne!(reg.resolve(&key(&b)).unwrap(), doc);
}

#[test]
fn keys_are_validated_and_a_session_registry_still_works() {
    let reg = DocRegistry::default();
    assert!(reg.resolve("").is_err());
    assert!(reg.resolve("path:").is_err());
    assert!(reg.resolve(&"k".repeat(5000)).is_err());
    assert_eq!(
        reg.resolve("path:/文档/笔记.md").unwrap(),
        reg.resolve("path:/文档/笔记.md").unwrap()
    );
    assert_eq!(
        reg.bind("tab:w/t", "tab:w/t").unwrap(),
        reg.resolve("tab:w/t").unwrap(),
        "a self-bind is a no-op"
    );
}

#[test]
fn a_rename_there_and_back_and_a_new_file_at_the_old_name_bind_correctly() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let (a, b) = (docs.path().join("a.md"), docs.path().join("b.md"));
    let first = reg.resolve(&key(&a)).unwrap();
    reg.bind(&key(&a), &key(&b)).unwrap();
    assert_eq!(reg.bind(&key(&b), &key(&a)).unwrap(), first);
    assert_eq!(reg.bind(&key(&a), &key(&b)).unwrap(), first);
    let second = reg.resolve(&key(&a)).unwrap();
    assert_ne!(second, first, "a new file at the old name");
    assert_eq!(
        reg.bind(&key(&a), &key(&b)).unwrap(),
        second,
        "its own Save As over b carries it"
    );
}

#[test]
fn a_failed_attach_keeps_every_session_mapping_and_a_retry_persists_them() {
    use crate::agent_journal::doc_index::APPENDS_BEFORE_FAILURE;
    let (journal, docs) = (tmp(), tmp());
    let reg = DocRegistry::default();
    let keys: Vec<String> = ["a.md", "b.md", "c.md"]
        .iter()
        .map(|n| key(&file(docs.path(), n, "x")))
        .collect();
    let ids: Vec<_> = keys.iter().map(|k| reg.resolve(k).unwrap()).collect();

    APPENDS_BEFORE_FAILURE.with(|n| n.set(Some(1)));
    let failed = reg.attach(journal.path());
    APPENDS_BEFORE_FAILURE.with(|n| n.set(None));
    assert!(failed.is_err(), "the second write fails");
    for (k, id) in keys.iter().zip(&ids) {
        assert_eq!(reg.find(k).unwrap(), Some(*id), "{k} keeps its session id");
    }

    reg.attach(journal.path()).expect("retry");
    let reopened = registry(journal.path());
    for (k, id) in keys.iter().zip(&ids) {
        assert_eq!(reopened.find(k).unwrap(), Some(*id), "{k} is durable");
    }
}

#[test]
fn overlapping_rename_roots_walk_each_file_once() {
    use crate::agent_journal::doc_renames::rename_candidates;
    let docs = tmp();
    let outer = docs.path().join("outer");
    let inner = outer.join("inner");
    fs::create_dir_all(&inner).unwrap();
    let a = file(&outer, "a.md", "a");
    let b = file(&inner, "b.md", "b");
    // A parent and its child named in one batch, the child twice.
    let mut found = rename_candidates(&[outer.clone(), inner.clone(), inner.clone(), b.clone()]);
    found.sort();
    let mut want = vec![a, b];
    want.sort();
    assert_eq!(found, want, "each file once, however many roots reach it");
}

#[test]
fn binding_a_path_to_an_untitled_key_releases_the_path_durably() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let other = file(docs.path(), "other.md", "y");
    let doc = reg.resolve(&key(&a)).unwrap();
    let kept = reg.resolve(&key(&other)).unwrap();
    assert_eq!(reg.bind(&key(&a), "tab:main/t1").unwrap(), doc);
    assert_eq!(reg.find(&key(&a)).unwrap(), None, "a is released at once");
    assert_eq!(
        reg.bind(&key(&a), "tab:main/t1").unwrap(),
        doc,
        "a repeated bind is a no-op"
    );
    assert_eq!(reg.find(&key(&a)).unwrap(), None);
    let b = file(docs.path(), "b.md", "x");
    assert_eq!(
        reg.bind("tab:main/t1", &key(&b)).unwrap(),
        doc,
        "b keeps the original document"
    );
    drop(reg);
    let reg = registry(journal.path());
    assert_eq!(reg.find(&key(&a)).unwrap(), None, "a stays released");
    assert_eq!(reg.find(&key(&b)).unwrap(), Some(doc));
    assert_eq!(reg.find(&key(&other)).unwrap(), Some(kept));
}

#[test]
fn a_failed_release_changes_no_mapping_and_a_retry_binds() {
    use crate::agent_journal::doc_index::REWRITE_FAILS_AFTER_REPLACE;
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let other = file(docs.path(), "other.md", "y");
    let doc = reg.resolve(&key(&a)).unwrap();
    let kept = reg.resolve(&key(&other)).unwrap();

    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(Some(false)));
    let failed = reg.bind(&key(&a), "tab:main/t1");
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(None));
    assert!(failed.is_err(), "the release could not be written");
    assert_eq!(
        reg.find(&key(&a)).unwrap(),
        Some(doc),
        "a keeps its document"
    );
    assert_eq!(
        reg.find("tab:main/t1").unwrap(),
        None,
        "the destination is not published"
    );
    assert_eq!(reg.find(&key(&other)).unwrap(), Some(kept));
    drop(reg);

    let reg = registry(journal.path());
    assert_eq!(reg.find(&key(&a)).unwrap(), Some(doc), "unchanged on disk");
    assert_eq!(reg.find(&key(&other)).unwrap(), Some(kept));
    assert_eq!(
        reg.bind(&key(&a), "tab:main/t1").unwrap(),
        doc,
        "a retry binds"
    );
    assert_eq!(reg.find(&key(&a)).unwrap(), None);
}

/// A probe is taken before the registry lock. Between the probe and the
/// move, the destination is replaced by a different file (the old identity
/// stays alive through a hard link, so it cannot be reused): the move must
/// not bind the document to a file that is no longer the renamed one.
#[test]
fn a_rename_probe_gone_stale_before_the_move_binds_nothing() {
    use crate::agent_journal::doc_renames::rename_probes;
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    let probes = rename_probes(std::slice::from_ref(&b));
    assert_eq!(probes.len(), 1);
    fs::hard_link(&b, docs.path().join("keep.md")).unwrap();
    let replacement = file(docs.path(), "c.md", "other");
    fs::rename(&replacement, &b).unwrap();
    assert_eq!(reg.apply_rename_probes(probes), 0, "stale identity");
    assert_ne!(reg.resolve(&key(&b)).unwrap(), doc);
}

/// Same race, but the destination becomes a symlink to the very file the
/// probe saw: the identity still matches, the canonical key does not.
#[cfg(unix)]
#[test]
fn a_rename_probe_whose_canonical_key_changed_before_the_move_binds_nothing() {
    use crate::agent_journal::doc_renames::rename_probes;
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "x");
    let doc = reg.resolve(&key(&a)).unwrap();
    let b = docs.path().join("b.md");
    fs::rename(&a, &b).unwrap();
    let probes = rename_probes(std::slice::from_ref(&b));
    let moved = docs.path().join("elsewhere.md");
    fs::rename(&b, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &b).unwrap();
    assert_eq!(reg.apply_rename_probes(probes), 0, "stale canonical key");
    assert_eq!(reg.find(&key(&b)).unwrap(), None);
    assert_eq!(
        reg.note_renames(std::slice::from_ref(&moved)),
        1,
        "the fresh event moves it"
    );
    assert_eq!(reg.find(&key(&moved)).unwrap(), Some(doc));
}

#[test]
fn a_save_as_before_the_index_attaches_replaces_the_overwritten_paths_document() {
    let (journal, docs) = (tmp(), tmp());
    let x = file(docs.path(), "x.md", "old");
    let old = registry(journal.path()).resolve(&key(&x)).unwrap();
    // Next launch: a Save As over x lands before startup attaches the index.
    let reg = DocRegistry::default();
    let untitled = reg.resolve("tab:main/t1").unwrap();
    assert_eq!(reg.bind("tab:main/t1", &key(&x)).unwrap(), untitled);
    reg.attach(journal.path()).expect("attach");
    assert_eq!(reg.find(&key(&x)).unwrap(), Some(untitled), "attached");
    assert_ne!(untitled, old);
    assert_eq!(
        registry(journal.path()).find(&key(&x)).unwrap(),
        Some(untitled),
        "durable across reopen"
    );
}

#[test]
fn an_external_rename_over_an_indexed_file_carries_the_source_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let a = file(docs.path(), "a.md", "a");
    let b = file(docs.path(), "b.md", "b");
    let doc_a = reg.resolve(&key(&a)).unwrap();
    reg.resolve(&key(&b)).unwrap();
    fs::rename(&a, &b).unwrap();
    assert_eq!(reg.note_renames(std::slice::from_ref(&b)), 1);
    assert_eq!(reg.find(&key(&b)).unwrap(), Some(doc_a), "b now holds a");
    assert_eq!(reg.find(&key(&a)).unwrap(), None, "a is released");
    assert_eq!(
        registry(journal.path()).find(&key(&b)).unwrap(),
        Some(doc_a),
        "durable across reopen"
    );
    // The destination already recording the probed file is left alone.
    assert_eq!(reg.note_renames(std::slice::from_ref(&b)), 0);
}

#[test]
fn a_swap_by_two_external_renames_follows_both_files_in_any_event_order() {
    for order in [["b.md", "c.md"], ["c.md", "b.md"]] {
        let (journal, docs) = (tmp(), tmp());
        let reg = registry(journal.path());
        let a = file(docs.path(), "a.md", "a");
        let b = file(docs.path(), "b.md", "b");
        let (doc_a, doc_b) = (
            reg.resolve(&key(&a)).unwrap(),
            reg.resolve(&key(&b)).unwrap(),
        );
        let c = docs.path().join("c.md");
        fs::rename(&b, &c).unwrap();
        fs::rename(&a, &b).unwrap();
        let named: Vec<PathBuf> = order.iter().map(|n| docs.path().join(n)).collect();
        assert_eq!(reg.note_renames(&named), 2, "{order:?}");
        assert_eq!(reg.find(&key(&c)).unwrap(), Some(doc_b), "{order:?}");
        assert_eq!(reg.find(&key(&b)).unwrap(), Some(doc_a), "{order:?}");
    }
}

/// Two indexed files exchange paths (a → t, b → a, t → b): both mappings
/// move together, whichever path the batch probes first, and stay moved
/// across a reopen.
#[test]
fn an_external_swap_of_two_indexed_files_follows_both_in_any_probe_order() {
    for order in [["a.md", "b.md"], ["b.md", "a.md"]] {
        let (journal, docs) = (tmp(), tmp());
        let reg = registry(journal.path());
        let a = file(docs.path(), "a.md", "a");
        let b = file(docs.path(), "b.md", "b");
        let (doc_a, doc_b) = (
            reg.resolve(&key(&a)).unwrap(),
            reg.resolve(&key(&b)).unwrap(),
        );
        let t = docs.path().join("t.md");
        fs::rename(&a, &t).unwrap();
        fs::rename(&b, &a).unwrap();
        fs::rename(&t, &b).unwrap();
        let named: Vec<PathBuf> = order.iter().map(|n| docs.path().join(n)).collect();
        assert_eq!(reg.note_renames(&named), 2, "{order:?}");
        assert_eq!(reg.find(&key(&a)).unwrap(), Some(doc_b), "{order:?}");
        assert_eq!(reg.find(&key(&b)).unwrap(), Some(doc_a), "{order:?}");
        let reopened = registry(journal.path());
        assert_eq!(
            reopened.find(&key(&a)).unwrap(),
            Some(doc_b),
            "{order:?} reopen"
        );
        assert_eq!(
            reopened.find(&key(&b)).unwrap(),
            Some(doc_a),
            "{order:?} reopen"
        );
    }
}

/// A Save As's bind delivered again late is the completed move, not a live
/// source: it never takes back a destination rebound since, nor copies the
/// document to a path it has moved on from.
#[test]
fn a_late_duplicate_save_as_bind_never_reclaims_or_copies_the_document() {
    let (journal, docs) = (tmp(), tmp());
    let reg = registry(journal.path());
    let x = file(docs.path(), "x.md", "x");
    let t = reg.resolve("tab:main/t").unwrap();
    assert_eq!(reg.bind("tab:main/t", &key(&x)).unwrap(), t);
    let u = reg.resolve("tab:main/u").unwrap();
    assert_eq!(reg.bind("tab:main/u", &key(&x)).unwrap(), u, "x saved over");
    assert_eq!(
        reg.bind("tab:main/t", &key(&x)).unwrap(),
        u,
        "late duplicate"
    );
    assert_eq!(reg.find(&key(&x)).unwrap(), Some(u));

    let v = reg.resolve("tab:main/v").unwrap();
    let y = file(docs.path(), "y.md", "y");
    let z = docs.path().join("z.md");
    assert_eq!(reg.bind("tab:main/v", &key(&y)).unwrap(), v);
    assert_eq!(reg.bind(&key(&y), &key(&z)).unwrap(), v, "renamed in-app");
    reg.bind("tab:main/v", &key(&y)).unwrap();
    assert_eq!(reg.find(&key(&z)).unwrap(), Some(v));
    assert_ne!(
        reg.find(&key(&y)).unwrap(),
        Some(v),
        "one document, one path"
    );
    assert_eq!(
        reg.resolve("tab:main/v").unwrap(),
        v,
        "a late resolve still follows"
    );
}

/// One renamed file reached by two new paths (a hard link made before the
/// event was handled): either could be the document, so neither takes it,
/// whatever order the probes arrive in.
#[test]
fn two_paths_claiming_one_renamed_mapping_move_nothing_in_any_order() {
    for order in [["b.md", "c.md"], ["c.md", "b.md"]] {
        let (journal, docs) = (tmp(), tmp());
        let reg = registry(journal.path());
        let a = file(docs.path(), "a.md", "a");
        let doc = reg.resolve(&key(&a)).unwrap();
        let b = docs.path().join("b.md");
        fs::rename(&a, &b).unwrap();
        fs::hard_link(&b, docs.path().join("c.md")).unwrap();
        let named: Vec<PathBuf> = order.iter().map(|n| docs.path().join(n)).collect();
        assert_eq!(reg.note_renames(&named), 0, "{order:?}");
        assert_eq!(reg.find(&key(&a)).unwrap(), Some(doc), "{order:?}");
        assert_eq!(reg.find(&key(&b)).unwrap(), None, "{order:?}");
    }
}
