// WI-AL1.2 — preimage binding: a prepare's preimage must equal the head text (STALE_PARENT), and a commit's resolves binds to its source
//! R3 — a prepare's preimage must be the head text (`STALE_PARENT`, nothing
//! appended, nothing reserved); before the first revision the recorded
//! baseline is genesis `""`, so unsaved buffer text is recorded as a human
//! observation first.
//! R1 — `resolves` binds to the restore source: only `uncommittedPreimage(T)`
//! sets it, it must name T, T is in the same document, and the restored text
//! must equal the source text (for every source kind). A source of another
//! document (revision or uncommitted transaction) is refused at prepare.
//!
//! Edge cases: CJK and astral text, a trailing-newline-only difference, a
//! pending (unlinearized) observation, a parent CAS failure taking
//! precedence, a refused commit leaving the transaction open and T untouched.

use super::test_support::*;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{HunkKind, RestoreSource, ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, ObserveRequest, Writer};

fn refused_without_effect(w: &Writer, doc: DocId, pre: &str) -> TxnError {
    let (len, gen) = (w.journal_len(), w.snapshot().generation);
    let err = w
        .prepare(prepare_req(doc, w.head(doc), pre, ReviewOp::Review))
        .unwrap_err();
    assert_eq!(
        (w.journal_len(), w.snapshot().generation),
        (len, gen),
        "nothing appended"
    );
    assert!(w.reservation(doc).is_none(), "nothing reserved");
    err
}

#[test]
fn preimage_must_equal_the_head_text() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let head = human_save(&w, doc, "中文 😀\n");
    for wrong in ["中文 😀", "中文 😀\n\n", "ab-unsaved", ""] {
        let err = refused_without_effect(&w, doc, wrong);
        assert_eq!(err, TxnError::StaleParent { head: Some(head) }, "{wrong:?}");
    }
    w.prepare(prepare_req(doc, Some(head), "中文 😀\n", ReviewOp::Review))
        .expect("exact head text");
}

#[test]
fn a_parent_cas_failure_is_reported_before_the_text_check() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let head = human_save(&w, doc, "a");
    let err = w
        .prepare(prepare_req(
            doc,
            Some(RevisionId::new()),
            "a",
            ReviewOp::Review,
        ))
        .unwrap_err();
    assert_eq!(err, TxnError::StaleParent { head: Some(head) });
}

#[test]
fn the_first_revision_is_checked_against_the_genesis_baseline() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    assert_eq!(
        refused_without_effect(&w, doc, "draft"),
        TxnError::StaleParent { head: None }
    );
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .expect("genesis baseline is empty");
    w.abort(p.txn, "x").unwrap();
    // Unsaved buffer text is captured first; while pending it is not a baseline.
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: "draft".into(),
        observed_parent: ObservedRef::Genesis,
        provenance: None,
    })
    .unwrap();
    assert_eq!(
        refused_without_effect(&w, doc, "draft"),
        TxnError::StaleParent { head: None }
    );
    let lin = w
        .linearize_next(
            doc,
            crate::agent_journal::writer::LinearizeRequest {
                expected_head: None,
                effects: ReviewEffects::default(),
            },
        )
        .unwrap()
        .unwrap();
    w.prepare(prepare_req(
        doc,
        Some(lin.revision),
        "draft",
        ReviewOp::Review,
    ))
    .expect("recorded baseline");
}

/// A transaction on `doc` left `uncommitted` by a crash after its prepare
/// over `base`; the head is then moved to `edited` by a human save.
fn uncommitted(dir: &std::path::Path, doc: DocId, base: &str, edited: &str) -> (Writer, TxnId) {
    let txn = {
        let (w, _) = open(dir);
        if head_text(&w, doc) != base {
            human_save(&w, doc, base);
        }
        w.prepare(prepare_req(doc, w.head(doc), base, ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, report) = Writer::open(config(dir, SyncPolicy::Full).0).unwrap();
    assert!(report.uncommitted.contains(&txn));
    human_save(&w, doc, edited);
    (w, txn)
}

/// Prepare a restore of `source` over the head and commit `post` with
/// `resolves`, one `restore` hunk covering the whole text.
fn restore(
    w: &Writer,
    doc: DocId,
    source: RestoreSource,
    post: &str,
    resolves: Option<TxnId>,
) -> Result<TxnId, TxnError> {
    let (head, pre) = (w.head(doc), head_text(w, doc));
    let op = ReviewOp::Restore { source };
    let p = w.prepare(prepare_req(doc, head, &pre, op.clone()))?;
    let len = |s: &str| s.encode_utf16().count() as u64;
    let h = hunk(
        head,
        p.revision,
        &pre,
        post,
        r(0, len(&pre)),
        r(0, len(post)),
        HunkKind::Restore,
    );
    let req = CommitRequest {
        resolves,
        ..barrier_commit_req(w, doc, post, vec![h], &op)
    };
    w.commit(p.txn, req).map(|_| p.txn)
}

fn status(w: &Writer, t: TxnId) -> TxnStatus {
    w.snapshot().state.txns[&t].status.clone()
}

#[test]
fn restoring_an_uncommitted_preimage_resolves_it() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, t) = uncommitted(dir.path(), doc, "base 中", "edited");
    let by = restore(
        &w,
        doc,
        RestoreSource::UncommittedPreimage { txn: t },
        "base 中",
        Some(t),
    )
    .unwrap();
    assert_eq!(status(&w, t), TxnStatus::Resolved { by });
    assert_eq!(head_text(&w, doc), "base 中");
}

#[test]
fn resolves_is_refused_unless_it_names_the_restored_uncommitted_transaction() {
    let dir = tmp();
    let doc = DocId::new();
    let (_, t1) = uncommitted(dir.path(), doc, "one", "two");
    let (w, t2) = uncommitted(dir.path(), doc, "two", "three");
    let src = |txn| RestoreSource::UncommittedPreimage { txn };
    let cases: Vec<(&str, RestoreSource, &str, Option<TxnId>)> = vec![
        ("wrong transaction", src(t1), "one", Some(t2)),
        ("resolves omitted", src(t1), "one", None),
        ("wrong restored text", src(t1), "two", Some(t1)),
        (
            "restored text of the other transaction",
            src(t1),
            "two",
            Some(t2),
        ),
    ];
    for (what, source, post, resolves) in cases {
        let err = restore(&w, doc, source, post, resolves).unwrap_err();
        assert_eq!(err.code(), "INVALID_REQUEST", "{what}");
        let open = w
            .reservation(doc)
            .expect("a refused commit keeps the transaction open")
            .txn;
        w.abort(open, "refused").unwrap();
        assert_eq!(
            (status(&w, t1), status(&w, t2)),
            (TxnStatus::Uncommitted, TxnStatus::Uncommitted),
            "{what}"
        );
    }
}

#[test]
fn an_uncommitted_transaction_of_another_document_is_not_a_source() {
    let dir = tmp();
    let (a, b) = (DocId::new(), DocId::new());
    let (_, ta) = uncommitted(dir.path(), a, "a-text", "a-edited");
    let (w, tb) = uncommitted(dir.path(), b, "b-text", "b-edited");
    let len = w.journal_len();
    let wrong_doc = restore(
        &w,
        b,
        RestoreSource::UncommittedPreimage { txn: ta },
        "a-text",
        Some(ta),
    )
    .unwrap_err();
    assert_eq!(wrong_doc.code(), "INVALID_REQUEST");
    assert_eq!(w.journal_len(), len, "refused at prepare");
    let cross = restore(
        &w,
        b,
        RestoreSource::UncommittedPreimage { txn: tb },
        "b-text",
        Some(ta),
    )
    .unwrap_err();
    assert_eq!(
        cross.code(),
        "INVALID_REQUEST",
        "resolves naming another document's transaction"
    );
    assert_eq!(status(&w, ta), TxnStatus::Uncommitted);
}

#[test]
fn no_other_mutation_may_set_resolves() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, t) = uncommitted(dir.path(), doc, "base", "edited");
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "edited", ReviewOp::Review))
        .unwrap();
    let mut req = commit_req(
        &w,
        doc,
        "base",
        Edit {
            at: 0,
            delete: 6,
            insert: 4,
        },
        vec![],
    );
    req.resolves = Some(t);
    assert_eq!(
        w.commit(p.txn, req).unwrap_err().code(),
        "INVALID_REQUEST",
        "a review commit"
    );
    w.abort(p.txn, "x").unwrap();
    let rev = w.head(doc).unwrap();
    human_save(&w, doc, "later");
    let err = restore(
        &w,
        doc,
        RestoreSource::Revision { revision: rev },
        "edited",
        Some(t),
    )
    .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "a revision restore");
    assert_eq!(status(&w, t), TxnStatus::Uncommitted);
}

#[test]
fn every_source_kind_checks_the_restored_text() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let rev = human_save(&w, doc, "kept text");
    human_save(&w, doc, "newer");
    let src = RestoreSource::Revision { revision: rev };
    assert_eq!(
        restore(&w, doc, src.clone(), "not it", None)
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
    w.abort(w.reservation(doc).unwrap().txn, "x").unwrap();
    restore(&w, doc, src, "kept text", None).expect("revision restore with its text");
    let line = r#"{"id":"cp-1","tabId":"t1","filePath":null,"timestamp":1,"tool":"t","contentBefore":"legacy"}"#;
    w.migrate_legacy(&[line]).unwrap();
    let src = RestoreSource::LegacyCheckpoint {
        legacy_id: "cp-1".into(),
    };
    assert_eq!(
        restore(&w, doc, src.clone(), "kept text", None)
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
    w.abort(w.reservation(doc).unwrap().txn, "x").unwrap();
    restore(&w, doc, src, "legacy", None).expect("legacy restore with its text");
}

#[test]
fn resolves_must_name_an_uncommitted_transaction() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    let req = CommitRequest {
        provenance: None,
        postimage: "x".into(),
        resolves: Some(TxnId::new()),
        effects: Default::default(),
    };
    assert_eq!(w.commit(p.txn, req).unwrap_err().code(), "INVALID_REQUEST");
    assert_eq!(
        w.reservation(doc).map(|r| r.txn),
        Some(p.txn),
        "a refused commit keeps the transaction open"
    );
}

#[test]
fn a_revision_of_another_document_is_not_a_restore_source() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let (a, b) = (DocId::new(), DocId::new());
    let ra = human_save(&w, a, "same text");
    human_save(&w, b, "b");
    let len = w.journal_len();
    // Even with identical text, the source must belong to the document.
    let err = restore(
        &w,
        b,
        RestoreSource::Revision { revision: ra },
        "same text",
        None,
    )
    .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST");
    assert_eq!(w.journal_len(), len, "refused at prepare, nothing appended");
    assert!(w.reservation(b).is_none());
}

#[test]
fn a_restore_carries_only_the_writer_barrier_never_a_worker_map() {
    // R21: a restore is a whole-document break. A worker map, however
    // well-formed, must not narrow it to a certified mapping.
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (_, source) = agent_change(
        &w,
        doc,
        "",
        "abc",
        Edit {
            at: 0,
            delete: 0,
            insert: 3,
        },
    );
    agent_change(
        &w,
        doc,
        "abc",
        "abcd",
        Edit {
            at: 3,
            delete: 0,
            insert: 1,
        },
    );
    let (head, pre) = (w.head(doc), head_text(&w, doc));
    let op = ReviewOp::Restore {
        source: RestoreSource::Revision { revision: source },
    };
    let p = w.prepare(prepare_req(doc, head, &pre, op.clone())).unwrap();
    let h = hunk(
        head,
        p.revision,
        &pre,
        "abc",
        r(0, 4),
        r(0, 3),
        HunkKind::Restore,
    );
    let req = commit_req_op(
        &w,
        doc,
        "abc",
        &[Edit {
            at: 3,
            delete: 1,
            insert: 0,
        }],
        vec![h],
        &op,
    );
    let len = w.journal_len();
    assert_eq!(w.commit(p.txn, req).unwrap_err().code(), "INVALID_REQUEST");
    assert_eq!(w.journal_len(), len, "nothing appended");
    assert!(w.reservation(doc).is_some(), "the transaction stays open");
}
