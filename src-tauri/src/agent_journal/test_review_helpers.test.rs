// WI-AL1.2 — review-test helpers shared by the review and reviewGen suites
//! Review-test helpers shared by `review.test.rs` and `review_gen.test.rs`.

use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::review::{HunkState, ReviewAction, ReviewItem, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, ReviewRequest, Writer};

use super::test_support::*;

pub const MAX: u64 = u64::MAX;

pub fn state(w: &Writer, doc: DocId, id: &HunkId) -> (HunkState, u64) {
    let s = w.snapshot().state;
    let h = &s.docs[&doc].hunks[id];
    (h.state, h.review_gen)
}

pub fn decide(
    w: &Writer,
    doc: DocId,
    action: ReviewAction,
    items: &[(&HunkId, u64)],
) -> Result<u64, crate::agent_journal::errors::TxnError> {
    w.decide(ReviewRequest {
        doc,
        expected_head: w.head(doc),
        action,
        items: items
            .iter()
            .map(|(h, g)| ReviewItem {
                hunk_id: (*h).clone(),
                expected_review_gen: *g,
            })
            .collect(),
    })
}

/// Two disjoint one-char hunks "yy" → "xx", in text order (ids are hashes,
/// so id order is not position order).
pub fn two_hunks(w: &Writer, doc: DocId) -> (HunkId, HunkId) {
    seed_hunks(w, doc, 2);
    let s = w.snapshot().state;
    let mut ids = hunk_ids(w, doc);
    ids.sort_by_key(|id| s.docs[&doc].hunks[id].hunk.target_range.start);
    (ids[0].clone(), ids[1].clone())
}

/// A certified human save of `text` through `edits` on the head, left pending.
pub fn certified_capture(w: &Writer, doc: DocId, text: &str, edits: &[Edit]) {
    let pre = head_text(w, doc);
    let p = payload(w, doc, &basis(w.head(doc)), &pre, text, edits);
    observe(w, doc, text, Some(p));
}

/// Revert hunk `id` (or revert its revert) of the head text, as planned by
/// the writer (`Writer::plan_revert`). `pre` must be the head text and
/// `post` the exact revert of it.
pub fn revert(
    w: &Writer,
    doc: DocId,
    id: &HunkId,
    pre: &str,
    post: &str,
) -> Result<crate::agent_journal::writer::CommitOutcome, crate::agent_journal::errors::TxnError> {
    let gen = state(w, doc, id).1;
    let op = ReviewOp::HunkRevert {
        hunk_id: id.clone(),
        expected_review_gen: gen,
    };
    let plan = w.plan_revert(doc, id);
    let p = w.prepare(prepare_req(doc, w.head(doc), pre, op))?;
    w.commit(
        p.txn,
        CommitRequest {
            postimage: post.into(),
            resolves: None,
            provenance: None,
            effects: plan?.effects,
        },
    )
}

/// Revert hunk `id` of the head text, whatever the text becomes.
pub fn revert_planned(
    w: &Writer,
    doc: DocId,
    id: &HunkId,
) -> Result<String, crate::agent_journal::errors::TxnError> {
    let plan = w.plan_revert(doc, id)?;
    let crate::agent_journal::revert_gate::RevertDecision::Apply { postimage, .. } =
        plan.decision.clone()
    else {
        return Err(crate::agent_journal::errors::TxnError::InvalidRequest(
            format!("{:?}", plan.decision),
        ));
    };
    revert(w, doc, id, &head_text(w, doc), &postimage).map(|_| postimage)
}
