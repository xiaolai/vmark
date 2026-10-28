// WI-AL4.1 — reading an existing export branch (pure): the stored revision→commit mapping is the branch's own trailers; re-export resumes after the last covered revision (also after journal GC, by tombstone ids); a tip advanced by a foreign commit is a conflict; a non-empty unrelated branch (foreign, another document, mixed, merged, or not a prefix of this journal) is refused
use super::branch::*;
use crate::agent_journal::ids::{DocId, RevisionId};

fn ours(doc: DocId, rev: RevisionId) -> BranchCommit {
    BranchCommit {
        id: format!("c-{rev}"),
        parents: 1,
        document: Some(doc.to_string()),
        revision: Some(rev.to_string()),
        collected: None,
    }
}

fn run(doc: DocId, first: RevisionId, last: RevisionId) -> BranchCommit {
    BranchCommit {
        id: format!("s-{first}"),
        parents: 1,
        document: Some(doc.to_string()),
        revision: None,
        collected: Some(format!("{first}..{last}")),
    }
}

fn foreign(id: &str) -> BranchCommit {
    BranchCommit {
        id: id.into(),
        parents: 1,
        document: None,
        revision: None,
        collected: None,
    }
}

/// Oldest first in, newest first out (the order `git log` prints).
fn newest_first(mut v: Vec<BranchCommit>) -> Vec<BranchCommit> {
    v.reverse();
    v
}

fn ids(n: usize) -> Vec<RevisionId> {
    (0..n).map(|_| RevisionId::new()).collect()
}

#[test]
fn re_export_resumes_after_the_last_covered_revision() {
    let doc = DocId::new();
    let chain = ids(4);
    let log = newest_first(vec![ours(doc, chain[0]), ours(doc, chain[1])]);
    assert_eq!(resume_point(&log, doc, &chain).expect("resume"), 2);
}

#[test]
fn an_up_to_date_branch_resumes_past_the_end_so_re_export_is_idempotent() {
    let doc = DocId::new();
    let chain = ids(2);
    let log = newest_first(vec![ours(doc, chain[0]), ours(doc, chain[1])]);
    assert_eq!(resume_point(&log, doc, &chain).expect("resume"), 2);
}

#[test]
fn a_synthetic_commit_covers_its_collected_range() {
    let doc = DocId::new();
    let chain = ids(5);
    let log = newest_first(vec![
        ours(doc, chain[0]),
        run(doc, chain[1], chain[2]),
        ours(doc, chain[3]),
    ]);
    assert_eq!(resume_point(&log, doc, &chain).expect("resume"), 4);
}

#[test]
fn a_branch_advanced_by_a_foreign_commit_is_a_conflict_not_an_overwrite() {
    let doc = DocId::new();
    let chain = ids(3);
    let log = newest_first(vec![ours(doc, chain[0]), foreign("user-commit")]);
    let err = resume_point(&log, doc, &chain).expect_err("conflict");
    assert_eq!(err.code(), "EXPORT_CONFLICT");
    let mut merge = foreign("merge");
    merge.parents = 2;
    let log = newest_first(vec![ours(doc, chain[0]), merge]);
    assert_eq!(
        resume_point(&log, doc, &chain)
            .expect_err("merge on top")
            .code(),
        "EXPORT_CONFLICT"
    );
}

#[test]
fn a_non_empty_unrelated_branch_is_refused() {
    let doc = DocId::new();
    let chain = ids(3);
    let unrelated = |log: Vec<BranchCommit>| {
        resume_point(&newest_first(log), doc, &chain)
            .expect_err("unrelated")
            .code()
    };
    assert_eq!(
        unrelated(vec![foreign("a"), foreign("b")]),
        "UNRELATED_BRANCH"
    );
    // Another document's export.
    assert_eq!(
        unrelated(vec![ours(DocId::new(), chain[0])]),
        "UNRELATED_BRANCH"
    );
    // VMark commits on top of foreign history.
    assert_eq!(
        unrelated(vec![foreign("root"), ours(doc, chain[0])]),
        "UNRELATED_BRANCH"
    );
    // Ours, foreign, ours: rewritten history.
    assert_eq!(
        unrelated(vec![
            ours(doc, chain[0]),
            foreign("mid"),
            ours(doc, chain[1])
        ]),
        "UNRELATED_BRANCH"
    );
    // A merge inside our history.
    let mut merged = ours(doc, chain[1]);
    merged.parents = 2;
    assert_eq!(
        unrelated(vec![ours(doc, chain[0]), merged]),
        "UNRELATED_BRANCH"
    );
}

#[test]
fn a_branch_that_is_not_a_prefix_of_this_journal_is_refused() {
    let doc = DocId::new();
    let chain = ids(3);
    let refuse = |log: Vec<BranchCommit>| {
        resume_point(&newest_first(log), doc, &chain)
            .expect_err("not a prefix")
            .code()
    };
    // Skips a revision.
    assert_eq!(
        refuse(vec![ours(doc, chain[0]), ours(doc, chain[2])]),
        "UNRELATED_BRANCH"
    );
    // Out of order.
    assert_eq!(
        refuse(vec![ours(doc, chain[1]), ours(doc, chain[0])]),
        "UNRELATED_BRANCH"
    );
    // A revision this journal does not have.
    assert_eq!(
        refuse(vec![ours(doc, RevisionId::new())]),
        "UNRELATED_BRANCH"
    );
    // A range written backwards.
    assert_eq!(
        refuse(vec![run(doc, chain[1], chain[0])]),
        "UNRELATED_BRANCH"
    );
    // Both trailers on one commit.
    let mut both = ours(doc, chain[0]);
    both.collected = Some(format!("{}..{}", chain[0], chain[0]));
    assert_eq!(refuse(vec![both]), "UNRELATED_BRANCH");
    // A malformed range.
    let mut bad = run(doc, chain[0], chain[0]);
    bad.collected = Some("not-a-range".into());
    assert_eq!(refuse(vec![bad]), "UNRELATED_BRANCH");
}

#[test]
fn the_branch_log_parses_trailers_and_parent_counts() {
    let doc = DocId::new();
    let rev = RevisionId::new();
    // `git log -z --format=format:` output: NUL between fields and commits.
    let raw = format!("aaa\0p1\0{doc}\0{rev}\0\0bbb\0p1 p2\0\0\0\0ccc\0\0{doc}\0\0x..y");
    let log = parse_log(&raw).expect("well-formed");
    assert_eq!(log.len(), 3);
    assert_eq!(log[0].id, "aaa");
    assert_eq!(log[0].parents, 1);
    assert_eq!(log[0].document.as_deref(), Some(doc.to_string().as_str()));
    assert_eq!(log[0].revision.as_deref(), Some(rev.to_string().as_str()));
    assert_eq!(log[0].collected, None);
    assert_eq!(log[1].parents, 2);
    assert_eq!(log[1].document, None);
    assert_eq!(log[2].parents, 0, "a root commit");
    assert_eq!(log[2].collected.as_deref(), Some("x..y"));
    assert!(parse_log("").expect("empty").is_empty(), "an empty log");
}

#[test]
fn a_trailer_value_holding_control_characters_stays_one_field() {
    // Commit messages may hold any byte but NUL: a hostile trailer value
    // with the old separators must not forge fields or another commit.
    let doc = DocId::new();
    let forged = format!("x\u{1f}\u{1f}{doc}\u{1e}fake\u{1f}p\u{1f}{doc}");
    let raw = format!("aaa\0p1\0{forged}\0\0");
    let log = parse_log(&raw).expect("well-formed");
    assert_eq!(log.len(), 1, "no injected commit");
    assert_eq!(log[0].document.as_deref(), Some(forged.as_str()));
    assert_eq!(log[0].revision, None);
}

#[test]
fn a_log_with_a_partial_record_is_refused() {
    for raw in ["aaa\0p1\0doc", "aaa\0p1\0d\0r\0c\0bbb"] {
        let err = parse_log(raw).expect_err("truncated");
        assert_eq!(err.code(), "GIT_FAILED", "{raw:?}");
    }
}
