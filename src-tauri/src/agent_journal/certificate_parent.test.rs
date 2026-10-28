// WI-AL2.1c — a selection.set certificate is bound to the parent the writer mints: a dirty-buffer Source set is certified and an older unaffected hunk reverts exactly, the same edit inside an older hunk supersedes it, a WYSIWYG post-apply certificate blocks only the touched block, and a preimage that is not the minted parent's text is uncertified and counted
//! Certified selection edits (R26, R53). Edge cases: the minted parent is
//! a baseline the writer recorded for unsaved text, not the head the
//! window last saw; a surrogate pair split by a changed run.

use super::support::*;
use super::FallbackReason;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::provenance::{BreakReason, Provenance, PROVENANCE_CAP};
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::{revert_planned, state};
use crate::agent_journal::test_support::*;

#[test]
fn a_dirty_buffer_write_is_certified_and_reverts_an_unaffected_hunk_exactly() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, agent_rev) = one_hunk(&w, &docs);
    // The unsaved buffer: a person typed "--" before the hunk.
    let dirty = unsaved_prefix(&w, doc, agent_rev);
    let set = cert(
        "--abXc",
        "--abXcZ",
        &[Edit {
            at: 6,
            delete: 0,
            insert: 1,
        }],
    );
    let p = prepare(
        &w,
        &docs,
        Req {
            flushed: Some(&dirty),
            certificate: Some(set),
            ..Req::new(Some(agent_rev), "--abXc")
        },
    )
    .unwrap();
    assert!(p.certified, "bound to the minted parent: {p:?}");
    assert_eq!(p.fallback_reason, None);
    assert!(
        p.baseline.is_some(),
        "the unsaved buffer is the minted parent"
    );
    let out = commit(&w, p.txn, "--abXcZ", None).unwrap();
    assert!(out.certified && out.applied && out.durable, "{out:?}");
    assert_eq!(
        hunk_ids(&w, doc).len(),
        2,
        "the set's own writer-derived hunk"
    );
    assert_eq!(span(&w, doc, &older).block, None, "mapped, not blocked");
    assert_eq!(revert_planned(&w, doc, &older).unwrap(), "--abcZ");
    assert_eq!(head_text(&w, doc), "--abcZ");
    assert_eq!(w.uncertified_fallbacks(), 0);
}

#[test]
fn the_same_edit_inside_an_older_hunk_supersedes_it() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, agent_rev) = one_hunk(&w, &docs);
    let set = cert(
        "abXc",
        "abYc",
        &[Edit {
            at: 2,
            delete: 1,
            insert: 1,
        }],
    );
    let p = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(set),
            ..Req::new(Some(agent_rev), "abXc")
        },
    )
    .unwrap();
    assert!(p.certified);
    assert!(commit(&w, p.txn, "abYc", None).unwrap().certified);
    assert_eq!(state(&w, doc, &older).0, HunkState::Superseded);
    let newer: Vec<_> = hunk_ids(&w, doc)
        .into_iter()
        .filter(|id| *id != older)
        .collect();
    assert_eq!(newer.len(), 1);
    assert_eq!(span(&w, doc, &newer[0]).range, r(2, 3));
}

/// Two agent hunks in two blocks: `X` in "oXne" (1..2), `Y` in "tYwo" (7..8).
fn two_blocks(w: &crate::agent_journal::writer::Writer, docs: &DocRegistry) -> TwoBlocks {
    let doc = docs.resolve(KEY).unwrap();
    human_save(w, doc, "one\n\ntwo");
    let ins = |at| Edit {
        at,
        delete: 0,
        insert: 1,
    };
    agent_change(w, doc, "one\n\ntwo", "oXne\n\ntwo", ins(1));
    let (_, head) = agent_change(w, doc, "oXne\n\ntwo", "oXne\n\ntYwo", ins(7));
    let ids = hunk_ids(w, doc);
    let by_start = |s| {
        ids.iter()
            .find(|id| span(w, doc, id).range.start == s)
            .unwrap()
            .clone()
    };
    TwoBlocks {
        doc,
        head,
        first: by_start(1),
        second: by_start(7),
    }
}

struct TwoBlocks {
    doc: crate::agent_journal::ids::DocId,
    head: crate::agent_journal::ids::RevisionId,
    first: crate::agent_journal::ids::HunkId,
    second: crate::agent_journal::ids::HunkId,
}

#[test]
fn a_wysiwyg_certificate_sent_on_commit_blocks_only_the_touched_block() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let t = two_blocks(&w, &docs);
    let pre = "oXne\n\ntYwo";
    let p = prepare(&w, &docs, Req::new(Some(t.head), pre)).unwrap();
    assert!(!p.certified, "WYSIWYG certifies after the apply");
    assert_eq!(p.fallback_reason, None, "no certificate is not a fallback");
    // The block observer's map: the second block [6, 10) rewritten.
    let mut map = Provenance::new(10, PROVENANCE_CAP).unwrap();
    map.break_range(6, 10, 5, BreakReason::UncertifiedRange, "wysiwyg")
        .unwrap();
    let post = "oXne\n\ntYwo!";
    let out = commit(&w, p.txn, post, Some(cert_of(pre, post, &map))).unwrap();
    assert!(out.certified, "{out:?}");
    assert_eq!(span(&w, t.doc, &t.first).block, None, "untouched block");
    assert_eq!(
        span(&w, t.doc, &t.second).block,
        block(BreakReason::UncertifiedRange, "wysiwyg")
    );
    assert_eq!(w.uncertified_fallbacks(), 0);
}

#[test]
fn a_preimage_that_is_not_the_minted_parents_text_is_uncertified_and_counted() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, agent_rev) = one_hunk(&w, &docs);
    let dirty = unsaved_prefix(&w, doc, agent_rev);
    // Built on the head the window last saw, not on its unsaved buffer.
    let stale = cert(
        "abXc",
        "abXcZ",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    );
    let p = prepare(
        &w,
        &docs,
        Req {
            flushed: Some(&dirty),
            certificate: Some(stale),
            ..Req::new(Some(agent_rev), "--abXc")
        },
    )
    .unwrap();
    assert!(!p.certified);
    assert_eq!(p.fallback_reason, Some(FallbackReason::NotTheParent));
    assert_eq!(w.uncertified_fallbacks(), 1);
    let out = commit(&w, p.txn, "--abXcZ", None).unwrap();
    assert!(!out.certified && out.applied && out.durable);
    assert_eq!(
        span(&w, doc, &older).block,
        block(BreakReason::WholeDocumentWrite, "agent")
    );
    assert_eq!(w.uncertified_fallbacks(), 1, "counted once");
}

#[test]
fn a_changed_run_that_splits_a_surrogate_pair_is_uncertified() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let head = human_save(&w, doc, "a😀b");
    // Replaces the low half of the pair only: units [2, 3).
    let split = cert(
        "a😀b",
        "a😀b",
        &[Edit {
            at: 2,
            delete: 1,
            insert: 1,
        }],
    );
    let p = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(split),
            ..Req::new(Some(head), "a😀b")
        },
    )
    .unwrap();
    assert_eq!(p.fallback_reason, Some(FallbackReason::SplitsACharacter));
    assert_eq!(w.uncertified_fallbacks(), 1);
}
