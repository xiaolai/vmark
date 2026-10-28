//! The identity index's version header: written first, validated before any
//! repair, replay, compaction or append, and kept by every rewrite. A log
//! this build cannot vouch for is refused byte-for-byte unchanged.
//!
//! Edge cases: a fresh file, an empty file, a headerless log, a torn tail
//! behind a mismatched header, a missing field, an incomplete header, a
//! duplicate header, older and newer versions, compaction and removing the
//! last mapping.

use std::fs;

use crate::agent_journal::doc_index::format::{header_line, FORMAT_VERSION, KEY_POLICY};
use crate::agent_journal::doc_index::{DocIndex, IndexEntry, IndexError, DOC_INDEX_FILE};
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

fn lines(dir: &std::path::Path) -> Vec<String> {
    fs::read_to_string(dir.join(DOC_INDEX_FILE))
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn header_count(dir: &std::path::Path) -> usize {
    lines(dir)
        .iter()
        .filter(|l| l.contains(r#""op":"header""#))
        .count()
}

const PUT: &str = r#"{"op":"put","key":"k:a","entry":{"doc":"01a16953-e9c2-7139-9e71-10d1b3e0d23e","path":"/a.md","fileId":null,"provisional":false}}"#;

#[test]
fn a_fresh_index_starts_with_exactly_one_header() {
    let dir = tmp();
    drop(DocIndex::open(dir.path()).unwrap());
    let written = lines(dir.path());
    assert_eq!(written.len(), 1, "{written:?}");
    assert_eq!(written[0], header_line().trim_end());
    assert!(written[0].contains(&format!(r#""format":{FORMAT_VERSION}"#)));
    assert!(written[0].contains(KEY_POLICY));
    // An empty file (created, never initialized) is fresh too.
    fs::write(dir.path().join(DOC_INDEX_FILE), b"").unwrap();
    drop(DocIndex::open(dir.path()).unwrap());
    assert_eq!(header_count(dir.path()), 1);
}

/// Every log this build cannot vouch for fails explicitly, with the file
/// exactly as it was: no tail repair, no compaction, no header written.
#[test]
fn an_incompatible_log_is_refused_with_the_file_unchanged() {
    let head = |format: &str, policy: &str| {
        format!(r#"{{"op":"header","format":{format},"keyPolicy":"{policy}"}}"#)
    };
    let cases = [
        format!("{PUT}\n"),
        format!("{}\n{PUT}\n{{\"op\":\"pu", head("99", KEY_POLICY)),
        format!("{}\n{PUT}\n", head("0", KEY_POLICY)),
        format!("{}\n", head(&FORMAT_VERSION.to_string(), "folded-v0")),
        format!("{}\n", r#"{"op":"header","keyPolicy":"x"}"#),
        head(&FORMAT_VERSION.to_string(), KEY_POLICY),
        format!("{}{}", header_line(), header_line()),
    ];
    for bytes in cases {
        let dir = tmp();
        let file = dir.path().join(DOC_INDEX_FILE);
        fs::write(&file, &bytes).unwrap();
        let opened = DocIndex::open(dir.path());
        assert_eq!(fs::read(&file).unwrap(), bytes.as_bytes(), "{bytes:?}");
        let Err(e) = opened else {
            panic!("accepted {bytes:?}");
        };
        let expected_incompatible = !bytes.starts_with(&header_line());
        assert_eq!(
            matches!(e, IndexError::Incompatible { .. }),
            expected_incompatible,
            "{bytes:?}: {e}"
        );
    }
}

#[test]
fn the_incompatibility_reason_says_nothing_was_modified() {
    let dir = tmp();
    fs::write(dir.path().join(DOC_INDEX_FILE), format!("{PUT}\n")).unwrap();
    let Err(e) = DocIndex::open(dir.path()) else {
        panic!("accepted a headerless log");
    };
    assert_eq!(
        e.to_string(),
        format!(
            "Document identity index normalization version unversioned is incompatible \
             with this build’s version {FORMAT_VERSION}/{KEY_POLICY}. Journal recording \
             is disabled; the index has not been modified."
        )
    );
}

#[test]
fn every_rewrite_keeps_exactly_one_leading_header() {
    let dir = tmp();
    {
        let mut idx = DocIndex::open(dir.path()).unwrap().0;
        idx.put("k:a", entry("/a.md")).unwrap();
        idx.put("k:b", entry("/b.md")).unwrap();
        idx.remap(|e| {
            e.insert("k:c".into(), entry("/c.md"));
        })
        .unwrap();
        assert_eq!(header_count(dir.path()), 1, "remap");
        idx.remove("k:a").unwrap();
        idx.remove("k:b").unwrap();
        idx.remove("k:c").unwrap();
        assert_eq!(
            lines(dir.path()).len(),
            1,
            "an empty mapping keeps the header"
        );
        for _ in 0..200 {
            idx.put("k:churn", entry("/churn.md")).unwrap();
        }
    }
    let idx = DocIndex::open(dir.path()).unwrap().0;
    let written = lines(dir.path());
    assert_eq!(written.len(), 2, "compacted: header + one put: {written:?}");
    assert_eq!(written[0], header_line().trim_end());
    assert!(idx.get("k:churn").is_some());
    drop(idx);
    assert!(DocIndex::open(dir.path()).is_ok(), "reopens");
}

/// A duplicate header behind a valid one is damage found by reading the
/// whole log before any repair: the torn tail after it is not cut off, so
/// the refused file is exactly as it was.
#[test]
fn a_duplicate_header_with_a_torn_tail_is_refused_unchanged() {
    let dir = tmp();
    let file = dir.path().join(DOC_INDEX_FILE);
    let bytes = format!("{}{}{{\"op\":\"pu", header_line(), header_line());
    fs::write(&file, &bytes).unwrap();
    let opened = DocIndex::open(dir.path());
    assert_eq!(fs::read(&file).unwrap(), bytes.as_bytes(), "file modified");
    assert!(
        matches!(opened, Err(IndexError::Corrupt { .. })),
        "{:?}",
        opened.err()
    );
}
