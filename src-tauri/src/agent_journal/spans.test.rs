// WI-AL1.2 — mapped spans stay fully persisted: every revision record restates the span of every non-settled hunk, so a reopen projects the shifted span; a delta-style record is refused
//! Every revision record carries the span of every non-settled hunk, so
//! the record of an unrelated later revision restates a span an earlier
//! revision shifted, and a reopen projects it unchanged. Dropping the
//! shifting revision (the collector) relies on this; it is tested with the
//! collector itself.

use super::test_support::*;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::ReviewEffects;
use crate::agent_journal::writer::{LinearizeRequest, ObserveRequest, Writer};

/// A human save certified as exactly `edit` (its provenance maps every
/// live span).
fn save_with_edit(w: &Writer, doc: DocId, text: &str, edit: Edit) -> RevisionId {
    human_edit(w, doc, text, &[edit])
}

fn spans_in_record(w: &Writer, rev: RevisionId) -> usize {
    w.debug_records()
        .into_iter()
        .find_map(|e| match e.record {
            Record::ObservedRevision {
                revision, effects, ..
            } if revision == rev => Some(effects.spans.len()),
            _ => None,
        })
        .expect("record of the revision")
}

#[test]
fn an_unrelated_revision_restates_a_shifted_span_and_a_reopen_projects_it() {
    let dir = tmp();
    let doc = DocId::new();
    let (shifter, before) = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "abc");
        agent_change(
            &w,
            doc,
            "abc",
            "abXc",
            Edit {
                at: 2,
                delete: 0,
                insert: 1,
            },
        );
        let id = hunk_ids(&w, doc)[0].clone();
        // Shift: two characters inserted before the hunk.
        let shifter = save_with_edit(
            &w,
            doc,
            "--abXc",
            Edit {
                at: 0,
                delete: 0,
                insert: 2,
            },
        );
        assert_eq!(w.snapshot().state.docs[&doc].hunks[&id].span.range, r(4, 5));
        // Unrelated revision after the shift; it still restates the span.
        let unrelated = save_with_edit(
            &w,
            doc,
            "--abXc!",
            Edit {
                at: 6,
                delete: 0,
                insert: 1,
            },
        );
        assert_eq!(
            spans_in_record(&w, unrelated),
            1,
            "an untouched hunk's span is persisted, not a delta"
        );
        // A clean close: reopen must not block the span (R24 is tested in provenance_epochs.test.rs).
        w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
        (
            shifter,
            w.snapshot().state.docs[&doc].hunks[&id].span.clone(),
        )
    };
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    assert!(w.snapshot().state.revisions.contains_key(&shifter));
    let span = w.snapshot().state.docs[&doc].hunks[&before.hunk_id]
        .span
        .clone();
    assert_eq!(span, before);
    assert_eq!((span.range, span.block), (r(4, 5), None));
}

#[test]
fn a_revision_that_omits_an_untouched_hunks_span_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "abc");
    agent_change(
        &w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    let head = w.head(doc);
    let before = w.journal_len();
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: "abXc!".into(),
        observed_parent: ObservedRef::Revision {
            revision: head.unwrap(),
        },
        provenance: None,
    })
    .unwrap();
    // Delta-style effects: the hunk was not touched, so no span is sent.
    let err = w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: head,
                effects: ReviewEffects::default(),
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "STALE_REVIEW");
    assert_eq!(w.head(doc), head, "nothing linearized");
    assert!(
        w.journal_len() > before,
        "only the observation itself was appended"
    );
}
