// WI-AL2.2h — an abandon racing a queued commit or a queued abort, in both lock orders: exactly one terminal intent is queued, it is the earlier one, and it is the one that drains; the later call is answered from that intent and queues nothing
//! R66's race tests. Each call decides inside one writer-lock hold, so
//! the two lock orders are the two call orders; appends fail so the first
//! terminal stays queued while the second call runs.

use crate::agent_journal::admission::admission_support::doc;
use crate::agent_journal::admission::lifecycle_support::wait_until;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;

/// The queued records of `KEY`'s document, as text.
fn queue(r: &Rig) -> Vec<String> {
    let d = doc(&r.c);
    let g = r.c.writer.lock();
    g.degraded
        .get(&d)
        .map(|q| q.iter().map(|q| format!("{:?}", q.record)).collect())
        .unwrap_or_default()
}

/// A prepared transaction, its payload, and appends failing from now on.
fn prepared() -> (Rig, Page, String, TxnId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.faults.fail_next_appends(u32::MAX);
    (r, a, p, txn)
}

/// Exactly one queued record, containing `needle`; then drain to `end`.
fn one_intent(r: &Rig, txn: TxnId, needle: &str, end: TxnStatus) {
    let q = queue(r);
    assert_eq!(q.len(), 1, "one terminal intent: {q:?}");
    assert!(q[0].contains(needle), "{q:?}");
    r.faults.fail_next_appends(0);
    wait_until("the queued intent to drain", || {
        r.status(txn) == Some(end.clone())
    });
    assert_eq!(r.sizes().4, 0);
}

#[test]
fn abandon_racing_a_queued_commit_keeps_the_earlier_intent() {
    // The commit first: the abandon is answered from the queued commit.
    let (r, a, p, txn) = prepared();
    r.commit(&a, txn, "text!").expect("the commit is queued");
    let later = r.abandon(&a.label, &p);
    assert!(
        later.as_ref().is_ok_and(|v| v["terminal"] == "committed"),
        "{later:?}"
    );
    one_intent(&r, txn, "Committed", TxnStatus::Committed);

    // The abandon first: the commit is refused.
    let (r, a, p, txn) = prepared();
    r.abandon(&a.label, &p).expect("the abort is queued");
    r.commit(&a, txn, "text!")
        .expect_err("the abandon came first");
    one_intent(&r, txn, "abandoned", TxnStatus::Aborted);
}

#[test]
fn abandon_racing_a_queued_abort_keeps_the_earlier_intent() {
    // The abort first: its reason survives, not the abandon's.
    let (r, a, p, txn) = prepared();
    r.abort(&a, txn).expect("the abort is queued");
    let later = r.abandon(&a.label, &p);
    assert!(
        later.as_ref().is_ok_and(|v| v["terminal"] == "aborted"),
        "{later:?}"
    );
    one_intent(&r, txn, "edited", TxnStatus::Aborted);

    // The abandon first: the abort is refused.
    let (r, a, p, txn) = prepared();
    r.abandon(&a.label, &p).expect("the abort is queued");
    r.abort(&a, txn).expect_err("the abandon came first");
    one_intent(&r, txn, "abandoned", TxnStatus::Aborted);
}
