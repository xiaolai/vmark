//! WI-AL1.6 — the durable identity index (ADR-AL7): one line per operation,
//! a bind is one operation, a torn tail is repaired before the next append,
//! an unreadable interior line fails loudly, and the log compacts.

use std::fs;

use crate::agent_journal::doc_index::{DocIndex, IndexEntry, DOC_INDEX_FILE};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::test_support::tmp;

fn entry(path: &str) -> IndexEntry {
    IndexEntry {
        doc: DocId::new(),
        path: path.into(),
        file_id: None,
        provisional: false,
    }
}

#[test]
fn every_byte_of_a_torn_bind_reopens_wholly_old_or_wholly_new_and_appends_after_repair() {
    let dir = tmp();
    let a = entry("/a.md");
    {
        let mut idx = DocIndex::open(dir.path()).unwrap().0;
        idx.put("k:a", a.clone()).unwrap();
        idx.move_key("k:a", "k:b", a.clone()).unwrap();
    }
    let file = dir.path().join(DOC_INDEX_FILE);
    let full = fs::read(&file).unwrap();
    let start = full[..full.len() - 1]
        .iter()
        .rposition(|&b| b == b'\n')
        .unwrap()
        + 1;
    for cut in start..full.len() {
        fs::write(&file, &full[..cut]).unwrap();
        let (mut idx, open) = DocIndex::open(dir.path()).unwrap();
        assert_eq!(open.repaired_tail_bytes, (cut - start) as u64);
        assert_eq!(
            idx.get("k:a").map(|e| e.doc),
            Some(a.doc),
            "the torn bind is wholly absent"
        );
        assert!(idx.get("k:b").is_none());
        let c = entry("/c.md");
        idx.put("k:c", c.clone()).unwrap();
        drop(idx);
        let idx = DocIndex::open(dir.path()).unwrap().0;
        assert_eq!(
            idx.get("k:c").map(|e| e.doc),
            Some(c.doc),
            "an append after repair survives"
        );
    }
    fs::write(&file, &full).unwrap();
    let idx = DocIndex::open(dir.path()).unwrap().0;
    assert!(
        idx.get("k:a").is_none(),
        "an acknowledged bind is wholly new"
    );
    assert_eq!(idx.get("k:b").map(|e| e.doc), Some(a.doc));
}

#[test]
fn an_unreadable_interior_line_fails_loudly() {
    let dir = tmp();
    {
        let mut idx = DocIndex::open(dir.path()).unwrap().0;
        idx.put("k:a", entry("/a.md")).unwrap();
        idx.put("k:b", entry("/b.md")).unwrap();
    }
    let file = dir.path().join(DOC_INDEX_FILE);
    let text = fs::read_to_string(&file).unwrap().replacen('{', "#", 1);
    fs::write(&file, text).unwrap();
    assert!(DocIndex::open(dir.path()).is_err());
}

#[test]
fn moving_onto_an_existing_key_replaces_it_and_a_missing_source_is_tolerated() {
    let dir = tmp();
    let mut idx = DocIndex::open(dir.path()).unwrap().0;
    let (a, b) = (entry("/a.md"), entry("/b.md"));
    idx.put("k:a", a.clone()).unwrap();
    idx.put("k:b", b).unwrap();
    idx.move_key("k:a", "k:b", a.clone()).unwrap();
    assert_eq!(idx.get("k:b").map(|e| e.doc), Some(a.doc));
    idx.move_key("k:gone", "k:c", a.clone()).unwrap();
    assert_eq!(idx.get("k:c").map(|e| e.doc), Some(a.doc));
}

#[test]
fn the_log_compacts_when_it_outgrows_its_live_entries_and_keeps_every_mapping() {
    let dir = tmp();
    let keep = entry("/keep.md");
    {
        let mut idx = DocIndex::open(dir.path()).unwrap().0;
        idx.put("k:keep", keep.clone()).unwrap();
        for _ in 0..300 {
            idx.put("k:churn", entry("/churn.md")).unwrap();
        }
    }
    let file = dir.path().join(DOC_INDEX_FILE);
    let before = fs::read_to_string(&file).unwrap().lines().count();
    let idx = DocIndex::open(dir.path()).unwrap().0;
    let after = fs::read_to_string(&file).unwrap().lines().count();
    assert!(
        before > 300 && after == 3,
        "header + two puts: {before} -> {after}"
    );
    assert_eq!(idx.get("k:keep").map(|e| e.doc), Some(keep.doc));
}

#[test]
fn an_empty_or_missing_index_opens_empty() {
    let dir = tmp();
    // Closed before the reopen: the app holds one index per journal, and
    // Windows refuses to replace a file another handle holds open.
    {
        let idx = DocIndex::open(dir.path()).unwrap().0;
        assert!(idx.get("k:a").is_none());
    }
    fs::write(dir.path().join(DOC_INDEX_FILE), b"").unwrap();
    assert!(DocIndex::open(dir.path()).unwrap().0.get("k:a").is_none());
}

fn lines(dir: &std::path::Path) -> Vec<String> {
    fs::read_to_string(dir.join(DOC_INDEX_FILE))
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn remove_rewrites_the_survivors_as_put_lines_and_survives_reopen() {
    let dir = tmp();
    let (a, b) = (entry("/a.md"), entry("/b.md"));
    {
        let mut idx = DocIndex::open(dir.path()).unwrap().0;
        idx.put("k:a", a.clone()).unwrap();
        idx.put("k:b", b.clone()).unwrap();
        idx.move_key("k:b", "k:c", b.clone()).unwrap();
        idx.remove("k:a").unwrap();
        assert!(idx.get("k:a").is_none(), "released at once");
        let before = lines(dir.path());
        idx.remove("k:missing").unwrap();
        assert_eq!(lines(dir.path()), before, "a missing key writes nothing");
        idx.put("k:d", a.clone()).unwrap();
    }
    let written = lines(dir.path());
    assert_eq!(written.len(), 3, "header + two puts: {written:?}");
    assert!(
        written[1..].iter().all(|l| l.contains(r#""op":"put""#)),
        "only the format every build reads: {written:?}"
    );
    let idx = DocIndex::open(dir.path()).unwrap().0;
    assert!(idx.get("k:a").is_none() && idx.get("k:b").is_none());
    assert_eq!(idx.get("k:c").map(|e| e.doc), Some(b.doc));
    assert_eq!(idx.get("k:d").map(|e| e.doc), Some(a.doc));
}

#[test]
fn a_failed_replace_leaves_every_mapping_and_the_file_as_they_were() {
    use crate::agent_journal::doc_index::REWRITE_FAILS_AFTER_REPLACE;
    let dir = tmp();
    let (a, b) = (entry("/a.md"), entry("/b.md"));
    let mut idx = DocIndex::open(dir.path()).unwrap().0;
    idx.put("k:a", a.clone()).unwrap();
    idx.put("k:b", b.clone()).unwrap();
    let before = lines(dir.path());
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(Some(false)));
    let failed = idx.remove("k:a");
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(None));
    assert!(failed.is_err());
    assert_eq!(idx.get("k:a").map(|e| e.doc), Some(a.doc));
    assert_eq!(lines(dir.path()), before);
    idx.put("k:c", b.clone()).expect("the index still appends");
    let idx = DocIndex::open(dir.path()).unwrap().0;
    assert_eq!(idx.get("k:a").map(|e| e.doc), Some(a.doc));
    assert_eq!(idx.get("k:c").map(|e| e.doc), Some(b.doc));
}

#[test]
fn a_failed_reopen_keeps_the_removal_and_refuses_to_append_through_the_old_handle() {
    use crate::agent_journal::doc_index::{IndexError, REWRITE_FAILS_AFTER_REPLACE};
    let dir = tmp();
    let (a, b) = (entry("/a.md"), entry("/b.md"));
    let mut idx = DocIndex::open(dir.path()).unwrap().0;
    idx.put("k:a", a).unwrap();
    idx.put("k:b", b.clone()).unwrap();
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(Some(true)));
    let removed = idx.remove("k:a");
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(None));
    removed.expect("the replacement landed: the removal stands");
    assert!(idx.get("k:a").is_none());
    assert!(matches!(
        idx.put("k:c", entry("/c.md")),
        Err(IndexError::Poisoned)
    ));
    assert!(matches!(idx.remove("k:b"), Err(IndexError::Poisoned)));
    assert_eq!(lines(dir.path()).len(), 2, "the header and k:b's put line");
    let idx = DocIndex::open(dir.path()).unwrap().0;
    assert!(idx.get("k:a").is_none() && idx.get("k:c").is_none());
    assert_eq!(idx.get("k:b").map(|e| e.doc), Some(b.doc));
}

/// Creating the index fsyncs its directory before any mapping is
/// acknowledged: the file's data is synced on every append, but a new name
/// survives a power loss only once the directory holding it is synced.
#[test]
fn creating_the_index_syncs_its_directory_and_reopening_does_not() {
    use crate::agent_journal::journal_file::DIR_SYNCS;
    let dir = tmp();
    DIR_SYNCS.with(|d| d.borrow_mut().clear());
    let mut idx = DocIndex::open(dir.path()).unwrap().0;
    let synced = DIR_SYNCS.with(|d| d.take());
    assert_eq!(
        synced,
        vec![dir.path().to_path_buf()],
        "created: one dir sync"
    );
    idx.put("k:a", entry("/a.md")).unwrap();
    drop(idx);
    DocIndex::open(dir.path()).unwrap();
    assert!(DIR_SYNCS.with(|d| d.take()).is_empty(), "reopened: none");
}
