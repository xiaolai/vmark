// WI-AL2.2f — a request's in-flight entry: a duplicate while the original is held before admission answers inFlight and runs no cleanup; a duplicate under another digest is a conflict; the original then admits, publishing its owner and leaving in-flight in one step; a dropped unsettled guard fences its id; an owner revoked after admission is swept to uncommitted
//! R60 rule 3 (concurrency), R65 and R66, through `Controller::prepare_framed`.

use std::thread;

use serde_json::Value;

use crate::agent_journal::admission::admission_support::body;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::projection::TxnStatus;

/// R65's invariant after the original admitted: one receipt, one
/// reservation, no in-flight entry, no fence, the owner kept.
fn assert_one_admission(r: &Rig) {
    assert_eq!(
        r.sizes(),
        (0, 0, 1, 1, 1),
        "(inflight, fences, owners, receipts, reservations)"
    );
}

#[test]
fn a_duplicate_while_held_is_in_flight() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let (h, go) = hold_original(&r, &a, &p);
    let before = r.journal_len();

    let dup = r.prepare(&a, &p).expect_err("a duplicate while held");
    assert_eq!(
        answer(&dup),
        ("JOURNAL_BUSY".into(), "inFlight".into(), Some(true))
    );
    assert_eq!(r.journal_len(), before, "the duplicate appended nothing");
    assert_eq!(r.sizes(), (1, 0, 0, 0, 0), "the original's entry only");

    go.send(()).unwrap();
    h.join().unwrap().expect("the original admits");
}

#[test]
fn paused_original_and_duplicate_then_admits() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let (h, go) = hold_original(&r, &a, &p);
    assert_eq!(state(&r.prepare(&a, &p).unwrap_err()), "inFlight");
    go.send(()).unwrap();
    let first = h.join().unwrap().expect("the original admits");
    assert_one_admission(&r);
    let again = r.prepare(&a, &p).expect("an identical retry is answered");
    assert_eq!(again, first, "from the receipt");
    assert_one_admission(&r);
}

#[test]
fn two_duplicates_race_one_original() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let (h, go) = hold_original(&r, &a, &p);
    let dups: Vec<_> = (0..2)
        .map(|_| {
            let (c, pages, label, p) = (r.c.clone(), r.pages.clone(), a.label.clone(), p.clone());
            thread::spawn(move || c.prepare_framed(&pages, &label, &p).map(|_| ()))
        })
        .collect();
    for d in dups {
        let e = d.join().unwrap().expect_err("a racing duplicate");
        assert_eq!(state(&e), "inFlight");
    }
    go.send(()).unwrap();
    h.join().unwrap().expect("the original admits");
    assert_one_admission(&r);
}

#[test]
fn refused_duplicate_then_original_admitted() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p: Value = serde_json::from_str(&r.p(&a, None, "text")).unwrap();
    let other = r.frame(&a, {
        let mut b = body(None, "other text", None);
        b["requestId"] = p["requestId"].clone();
        b
    });
    let p = p.to_string();
    let (h, go) = hold_original(&r, &a, &p);
    let dup = r
        .prepare(&a, &other)
        .expect_err("the same id under another digest");
    assert_eq!(
        answer(&dup),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
    go.send(()).unwrap();
    h.join()
        .unwrap()
        .expect("the refused duplicate removed nothing of the original's");
    assert_one_admission(&r);
}

#[test]
fn admission_then_owner_release_is_uncommitted() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let reply = r.prepare(&a, &r.p(&a, None, "text")).expect("prepare");
    let txn = txn_of(&reply);
    assert_one_admission(&r);

    r.pages.started(&a.label);
    r.c.sweep(&r.pages);
    assert_eq!(
        r.status(txn),
        Some(TxnStatus::Uncommitted),
        "owner death, never aborted"
    );
    assert_eq!(
        r.sizes(),
        (0, 0, 0, 1, 0),
        "the owner left with its reservation"
    );
}

#[test]
fn an_unsettled_guard_fences_its_id_when_dropped() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    r.faults.before_nth_lock(
        2,
        Some(Box::new(|| panic!("a panic between begin and admission"))),
    );
    let (c, pages, label, q) = (r.c.clone(), r.pages.clone(), a.label.clone(), p.clone());
    let joined = thread::spawn(move || c.prepare_framed(&pages, &label, &q).map(|_| ())).join();
    assert!(joined.is_err(), "the attempt panicked");
    assert_eq!(r.sizes(), (0, 1, 0, 0, 0), "the entry left as a fence");

    let late = r.prepare(&a, &p).expect_err("a later attempt of the id");
    assert_eq!(
        answer(&late),
        ("STALE_REQUEST".into(), "abandoned".into(), Some(false))
    );
}

#[test]
fn a_page_revoked_between_begin_and_admission_is_stale_generation() {
    // The liveness is checked again in the second critical section: a
    // Started that lands while the document resolves revokes the attempt.
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let len = r.journal_len();
    let (pages, label) = (r.pages.clone(), a.label.clone());
    // Arm the hook last: any writer lock taken after it shifts the count.
    r.faults
        .before_nth_lock(2, Some(Box::new(move || pages.started(&label))));
    let e = r.prepare(&a, &p).expect_err("revoked before admission");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "staleGeneration".into(), Some(true))
    );
    assert_eq!(r.journal_len(), len, "nothing appended");
    let (inflight, _, owners, receipts, reservations) = r.sizes();
    assert_eq!((inflight, owners, receipts, reservations), (0, 0, 0, 0));
}
