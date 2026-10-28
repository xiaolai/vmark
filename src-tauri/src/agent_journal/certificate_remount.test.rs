// WI-AL2.1c — a remount without a certificate: the remounted view's touched, equal-text buffer is a snapshotOnly baseline that a later selection.set certificate does not lift, so after a reopen a revert of the older hunk refuses AMBIGUOUS_REVERT with the journal and the projection unchanged
//! A certificate maps only the minted parent's text to the postimage; it
//! never certifies what happened before that parent. A remounted view has
//! no map of its own history, so the baseline it reports stays a barrier.

use super::support::*;
use crate::agent_journal::controlled::ControlledPrepared;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::test_review_helpers::revert;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// What a remounted view reports: its text equals the head, but a new view
/// cannot say nobody touched it, and it has no flushed map. Its Source set
/// carries a certificate from the new view's own observer.
fn remount_then_set(w: &Writer, docs: &DocRegistry, head: RevisionId) -> ControlledPrepared {
    let set = cert(
        "abXc",
        "abXc!",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    );
    prepare(
        w,
        docs,
        Req {
            touched: true,
            certificate: Some(set),
            ..Req::new(Some(head), "abXc")
        },
    )
    .unwrap()
}

#[test]
fn a_remount_without_a_certificate_refuses_with_journal_and_projection_unchanged() {
    let dir = tmp();
    let (doc, older) = {
        let (w, _) = open_fast(dir.path());
        let docs = DocRegistry::default();
        let (doc, older, agent_rev) = one_hunk(&w, &docs);
        let p = remount_then_set(&w, &docs, agent_rev);
        assert!(p.baseline.is_some(), "the remounted buffer is recorded");
        assert!(p.certified, "the set itself is certified against it");
        assert!(commit(&w, p.txn, "abXc!", None).unwrap().certified);
        (doc, older)
    };
    let (cfg, _) = config(dir.path(), SyncPolicy::None);
    let (w, _) = Writer::open(cfg).expect("reopen");
    assert_eq!(
        span(&w, doc, &older).block,
        block(BreakReason::SnapshotOnly, "snapshot"),
        "the remount's barrier survives the certified set and the reopen"
    );
    let proj = w.snapshot().state;
    let len = w.journal_len();
    let err = revert(&w, doc, &older, "abXc!", "abc!").unwrap_err();
    assert_eq!(err.code(), "AMBIGUOUS_REVERT", "{err}");
    assert_eq!(w.snapshot().state, proj, "projection unchanged");
    assert_eq!(w.journal_len(), len, "journal unchanged");
}
