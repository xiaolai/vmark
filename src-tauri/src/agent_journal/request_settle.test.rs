// WI-AL2.2f — every request-protocol call that ends or refuses a transaction settles its document: a human save held behind the reservation is linearized once a commit, an abort, an abandon or the sweep releases it; every answer read from a request's own receipt (a stored reply, terminal, terminalPending) and every refused framed prepare restarts a degraded document's drain, while a conflicting retry restarts nothing; an abandon whose abort cannot be queued past the byte budget is unavailable with the transaction left open and its document settled; and an abort queued behind a queued save leaves no owner
//! R52.3, R60 rule 3 and R72, through the `Controller` core methods.

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::admission_support::{body, doc, KEY};
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::capture_tests::capture_payload;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::{Backoff, DrainScheduler};
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::writer::RetentionBudget;

/// A prepared transaction of `KEY` from page `a`, with a human save
/// held behind it.
fn held() -> (Rig, Page, String, TxnId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    held_save(&r);
    (r, a, p, txn)
}

#[test]
fn an_owned_commit_linearizes_the_held_save() {
    let (r, a, _, txn) = held();
    r.commit(&a, txn, "text!").expect("commit");
    assert_eq!(pending(&r), 0);
}

#[test]
fn an_owned_abort_linearizes_the_held_save() {
    let (r, a, _, txn) = held();
    r.abort(&a, txn).expect("abort");
    assert_eq!(pending(&r), 0);
}

#[test]
fn the_sweep_linearizes_the_held_save() {
    let (r, a, _, txn) = held();
    r.pages.destroy(&a.label);
    r.c.sweep(&r.pages);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(pending(&r), 0);
}

/// A rig whose drainer threads never start: every drain is the one
/// inline attempt `ensure` makes, so only a call that settles drains.
fn threadless() -> Rig {
    let r = rig();
    let drains = DrainScheduler::with_spawn(
        Backoff {
            first: Duration::from_millis(1),
            max: Duration::from_millis(4),
        },
        |_| Err(std::io::Error::other("no threads")),
    );
    let c = Controller::new(r.c.writer.clone(), r.c.docs.clone(), Arc::new(drains));
    Rig { c, ..r }
}

#[test]
fn a_framed_prepare_refused_on_a_degraded_document_restarts_its_drain() {
    let r = threadless();
    let a = r.page("doc-a", 1);
    let txn = txn_of(&r.prepare(&a, &r.p(&a, None, "text")).expect("prepare"));
    // The commit's append and the inline drain it starts both fail.
    r.faults.fail_next_appends(2);
    r.commit(&a, txn, "text!").expect("the commit is queued");
    let d = doc(&r.c);
    assert!(r.c.writer.is_degraded(d), "left armed, nothing draining");

    let e = r
        .prepare(&a, &r.p(&a, None, "text!"))
        .expect_err("a degraded document refuses");
    assert_eq!(state(&e), "notAdmitted");
    assert!(!r.c.writer.is_degraded(d), "the refusal drained the queue");
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));
}

#[test]
fn an_abandon_whose_abort_overflows_the_queue_budget_is_unavailable() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    // Another document's commit is queued, its text filling the budget.
    let mut other = body(None, "elsewhere", None);
    other["docKey"] = json!("path:/notes/other.md");
    let q = r.frame(&a, other);
    let other_txn = txn_of(&r.prepare(&a, &q).expect("prepare the other document"));
    r.faults.fail_next_appends(u32::MAX);
    r.commit(&a, other_txn, "elsewhere!").expect("queued");
    r.c.writer.set_retention_budget(RetentionBudget {
        degraded_bytes: 1,
        ..RetentionBudget::default()
    });

    let e = r.abandon(&a.label, &p).expect_err("the abort cannot queue");
    assert_eq!(
        answer(&e),
        ("JOURNAL_DEGRADED".into(), "unavailable".into(), Some(true))
    );
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared), "left open");
    let g = r.c.writer.lock();
    assert!(g.requests.owners.contains_key(&txn), "still owned");
    assert_eq!(g.reservations.get(&doc(&r.c)).map(|res| res.txn), Some(txn));
    drop(g);
    r.faults.fail_next_appends(0);
}

/// A human save of `KEY` while its appends fail: queued, so the document
/// is degraded.
fn queue_save(r: &Rig) {
    let save = capture_payload(KEY, "main/t1", None, "human", &Actor::Human);
    r.c.capture(&save).expect("the save is queued, not refused");
    assert!(r.c.writer.is_degraded(doc(&r.c)), "degraded");
}

/// Queue a human save of `KEY` behind two failed appends (its own and
/// the inline drain's) on a threadless rig: nothing is draining it.
fn degrade_with_queued_save(r: &Rig) {
    r.faults.fail_next_appends(2);
    queue_save(r);
}

#[test]
fn an_abandon_refused_past_the_budget_restarts_the_degraded_drain() {
    let r = threadless();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    // Another document's queued commit holds the queue's bytes; a save
    // queued behind KEY's reservation leaves KEY degraded, undrained.
    let mut other = body(None, "elsewhere", None);
    other["docKey"] = json!("path:/notes/other.md");
    let q = r.frame(&a, other);
    let other_txn = txn_of(&r.prepare(&a, &q).expect("prepare the other document"));
    r.faults.fail_next_appends(u32::MAX);
    r.commit(&a, other_txn, "elsewhere!").expect("queued");
    queue_save(&r);
    r.c.writer.set_retention_budget(RetentionBudget {
        degraded_bytes: 1,
        ..RetentionBudget::default()
    });
    r.faults.fail_next_appends(0);
    let e = r.abandon(&a.label, &p).expect_err("the abort cannot queue");
    assert_eq!(
        answer(&e),
        ("JOURNAL_DEGRADED".into(), "unavailable".into(), Some(true))
    );
    assert!(
        !r.c.writer.is_degraded(doc(&r.c)),
        "the queued save drained"
    );
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared), "left open");
}

#[test]
fn an_abort_queued_behind_a_save_releases_its_owner() {
    let r = threadless();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    txn_of(&r.prepare(&a, &p).expect("prepare"));
    degrade_with_queued_save(&r);
    r.faults.fail_next_appends(u32::MAX);
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon")["state"],
        "abortQueued"
    );
    assert_eq!(r.sizes().2, 0, "a queued terminal leaves no owner");
    r.faults.fail_next_appends(0);
}

/// A threadless rig with `KEY`'s commit queued and nothing draining it.
fn queued_commit() -> (Rig, Page, String, TxnId) {
    let r = threadless();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.faults.fail_next_appends(2);
    r.commit(&a, txn, "text!").expect("queued");
    assert!(r.c.writer.is_degraded(doc(&r.c)), "degraded, not draining");
    (r, a, p, txn)
}

#[test]
fn a_terminal_pending_retry_restarts_the_drain() {
    let (r, a, p, txn) = queued_commit();
    assert_eq!(state(&r.prepare(&a, &p).unwrap_err()), "terminalPending");
    assert!(!r.c.writer.is_degraded(doc(&r.c)));
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));
}

#[test]
fn a_terminal_pending_abandon_restarts_the_drain() {
    let (r, a, p, txn) = queued_commit();
    let out = r.abandon(&a.label, &p).expect("reported");
    assert_eq!(out["state"], "terminalPending");
    assert!(!r.c.writer.is_degraded(doc(&r.c)));
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));
}

#[test]
fn a_stored_reply_on_a_degraded_document_restarts_the_drain() {
    let r = threadless();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let first = r.prepare(&a, &p).expect("prepare");
    degrade_with_queued_save(&r);
    assert_eq!(r.prepare(&a, &p).expect("the stored reply"), first);
    assert!(!r.c.writer.is_degraded(doc(&r.c)));
}

#[test]
fn a_terminal_answer_on_a_degraded_document_restarts_the_drain() {
    for via_abandon in [false, true] {
        let r = threadless();
        let a = r.page("doc-a", 1);
        let p = r.p(&a, None, "text");
        let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
        r.commit(&a, txn, "text!").expect("commit");
        degrade_with_queued_save(&r);
        let s = if via_abandon {
            r.abandon(&a.label, &p).expect("reported")["state"].clone()
        } else {
            json!(state(&r.prepare(&a, &p).unwrap_err()))
        };
        assert_eq!(s, json!("terminal"), "abandon: {via_abandon}");
        assert!(!r.c.writer.is_degraded(doc(&r.c)), "abandon: {via_abandon}");
    }
}

#[test]
fn a_conflicting_retry_on_a_degraded_document_restarts_nothing() {
    let (r, a, p, txn) = queued_commit();
    let other = with(&p, "preimage", json!("texT"));
    assert_eq!(state(&r.prepare(&a, &other).unwrap_err()), "conflict");
    assert_eq!(state(&r.abandon(&a.label, &other).unwrap_err()), "conflict");
    assert!(
        r.c.writer.is_degraded(doc(&r.c)),
        "a conflict reads no receipt of its own"
    );
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));
}
