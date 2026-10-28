// WI-AL2.2e — R31's retention sequence through the writer: a revert refused AMBIGUOUS_REVERT over a frozen window holding a sticky break appends nothing; the released window then reaches the journal in front of a disjoint certified edit in the next save, which keeps the break on the reached hunk while an unaffected hunk reverts exactly — live, and across a restart with the break still on the span
//! The writer half of R31 tests 3 and 4. The session half (`release()`
//! merges the frozen window in front of its successor, sticky breaks
//! included) is `provenanceRelease.test.ts`; here the merged window it
//! certifies is the save's payload.

use super::revert_support::*;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::provenance::{
    Block, BreakReason, Provenance, ProvenancePayload, PROVENANCE_CAP,
};
use crate::agent_journal::provenance_field::ProvenanceField;
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::{revert_planned, state};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// The frozen window over "xxx": an uncertified replacement of A's `x` by `w`.
fn frozen() -> Provenance {
    let mut p = Provenance::new(3, PROVENANCE_CAP).expect("window");
    p.break_range(0, 1, 1, BreakReason::UncertifiedRange, "user")
        .expect("bounded break");
    p
}

fn encoded(w: &Writer, doc: DocId, post: &str, win: &Provenance) -> ProvenancePayload {
    let epoch = ensure_epoch(w, doc).to_string();
    ProvenancePayload::encode(
        &doc.to_string(),
        &epoch,
        &basis(w.head(doc)),
        &head_text(w, doc),
        post,
        win,
    )
    .expect("payload")
}

fn sticky() -> Option<Block> {
    Some(Block::new(BreakReason::UncertifiedRange, "user").expect("block"))
}

/// "xxx" with agent hunks A, B and C, one character each; a revert of A
/// over the frozen buffer "wxx" is refused with nothing appended; then the
/// released window and a tail insert are saved as one certified window.
/// The break reaches A and, through their shared edge, B — never C.
fn refused_then_saved(w: &Writer, doc: DocId) -> (HunkId, HunkId) {
    seed_hunks(w, doc, 3);
    let s = w.snapshot().state;
    let mut ids = hunk_ids(w, doc);
    ids.sort_by_key(|id| s.docs[&doc].hunks[id].hunk.target_range.start);
    let (a, c) = (ids[0].clone(), ids[2].clone());
    let field: ProvenanceField = serde_json::from_value(
        serde_json::to_value(encoded(w, doc, "wxx", &frozen())).expect("payload"),
    )
    .expect("field");
    let mut req = rreq(w, doc, "wxx", &a);
    req.baseline_provenance = Some(field);
    let before = w.lock().proj.clone();
    let marked = mark(w);
    let e = run(w, doc, req, None).expect_err("a blocked hunk");
    assert!(
        matches!(&e, TxnError::AmbiguousRevert { block: Some(b), .. }
            if b.reason == BreakReason::UncertifiedRange),
        "{e:?}"
    );
    let after = w.lock().proj.clone();
    assert_eq!(after, before, "the refusal changes nothing");
    assert_eq!(mark(w), marked, "the refusal appends nothing");

    let mut merged = frozen();
    merged
        .compose(&[section(Edit {
            at: 3,
            delete: 0,
            insert: 1,
        })])
        .expect("the successor's certified edit");
    let p = encoded(w, doc, "wxxq", &merged);
    observe(w, doc, "wxxq", Some(p));
    linearize(w, doc);
    (a, c)
}

fn span_block(w: &Writer, doc: DocId, id: &HunkId) -> Option<Block> {
    w.snapshot().state.docs[&doc].hunks[id].span.block.clone()
}

#[test]
fn a_refused_revert_then_a_disjoint_edit_and_a_save_lets_an_unaffected_hunk_revert_exactly() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, c) = refused_then_saved(&w, doc);
    assert_eq!(head_text(&w, doc), "wxxq");
    assert_eq!(span_block(&w, doc, &a), sticky(), "the break survived");
    assert_eq!(span_block(&w, doc, &c), None, "C is out of its reach");
    assert_eq!(revert_planned(&w, doc, &c).expect("revert C"), "wxyq");
    assert_eq!(head_text(&w, doc), "wxyq");
    assert_eq!(state(&w, doc, &c).0, HunkState::Reverted);
    assert_eq!(state(&w, doc, &a).0, HunkState::Pending);
}

#[test]
fn the_same_sequence_across_a_restart_keeps_the_sticky_break() {
    let dir = tmp();
    let doc = DocId::new();
    let (a, c) = {
        let (w, _) = open(dir.path());
        let ids = refused_then_saved(&w, doc);
        if let Some(epoch) = w.epoch(doc) {
            w.close_epoch(doc, epoch).expect("close epoch");
        }
        ids
    };
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).expect("reopen");
    assert_eq!(span_block(&w, doc, &a), sticky(), "the break survived");
    assert_eq!(revert_planned(&w, doc, &c).expect("revert C"), "wxyq");
    assert_eq!(state(&w, doc, &c).0, HunkState::Reverted);
}
