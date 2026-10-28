// WI-AL2.2h — owner death through the page entries and the cleanup worker's pass, one case per state at revocation: prepared is recorded uncommitted, released and durable; a failing append is queued with the reservation kept and the drainer alone releases it, also behind a held save and after three failed retries; a queued commit or abort is left as it is and survives; committed, aborted and uncommitted are already terminal; a full byte budget still queues the uncommitted record, the queue's bytes unchanged; destroying one window ends only its transactions; a corrupt writer ends nothing; a poisoned journal queues and a reopen records uncommitted; discarded and resolved are already terminal too, with nothing appended; a missing reservation is counted and the transaction still ended uncommitted, durably, another transaction's reservation untouched; revocation never re-enters the writer lock; and a transaction the live prepare left without an owner is refused to a registered page's commit
//! R66 and R72 as amended by R78, through `Life` (hook, destroy) and the
//! production sweep pass.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::{body, doc, request_id, KEY};
use crate::agent_journal::admission::lifecycle_support::{life, wait_until, Life};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::admission::requests::Owner;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::test_support::human_save;
use crate::agent_journal::writer::{Reservation, RetentionBudget};

const OTHER: &str = "path:/notes/other.md";

/// A prepared transaction of `KEY` owned by page 1 in `doc-a`.
fn owned(l: &Life) -> (Page, TxnId) {
    let a = l.r.page("doc-a", 1);
    let txn = txn_of(&l.r.prepare(&a, &l.r.p_head(&a, "text")).expect("prepare"));
    (a, txn)
}

/// A prepared transaction of the other document, owned by `page`.
fn owned_other(l: &Life, page: &Page, preimage: &str) -> TxnId {
    let head =
        l.r.c
            .docs
            .resolve(OTHER)
            .ok()
            .and_then(|d| l.r.c.writer.head(d));
    let mut other = body(head, preimage, None);
    other["docKey"] = json!(OTHER);
    let q = l.r.frame(page, other);
    txn_of(&l.r.prepare(page, &q).expect("prepare the other document"))
}

/// The queued records of `KEY`'s document, as text.
fn queue(l: &Life) -> Vec<String> {
    let d = doc(&l.r.c);
    let g = l.r.c.writer.lock();
    g.degraded
        .get(&d)
        .map(|q| {
            q.iter()
                .map(|q| format!("{:?} {:?}", q.txn, q.record))
                .collect()
        })
        .unwrap_or_default()
}

/// Give `txn` an owner no label holds, as a writer that kept one would.
fn orphan(l: &Life, txn: TxnId) {
    let gone = Owner {
        label: "gone".into(),
        generation: u64::MAX,
    };
    l.r.c.writer.lock().requests.owners.insert(txn, gone);
}

fn breaks(l: &Life) -> u64 {
    l.r.c.writer.lock().requests.owner_invariant_breaks
}

/// Revoke `label` through the hook entry and wait for the pass.
fn reload(l: &Life, label: &str) {
    l.started(label);
    l.idle();
}

fn released(l: &Life, txn: TxnId) {
    wait_until("the drainer to release the reservation", || {
        l.r.status(txn) == Some(TxnStatus::Uncommitted) && l.r.sizes().4 == 0
    });
}

#[test]
fn cleanup_append_failing_once_is_released_by_the_drainer_alone() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.faults.fail_next_appends(1);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    released(&l, txn);
}

#[test]
fn prepared_with_its_reservation_is_recorded_released_and_durable() {
    let l = life();
    let (a, txn) = owned(&l);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(l.r.sizes(), (0, 0, 0, 1, 0));
    let r = l.into_rig().reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted), "durable");
}

#[test]
fn a_failing_append_is_queued_with_the_reservation_kept_until_the_drain() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.faults.fail_next_appends(u32::MAX);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    assert_eq!(
        (l.r.sizes().2, l.r.sizes().4),
        (0, 1),
        "owner gone, reservation kept"
    );
    assert_eq!(queue(&l).len(), 1);
    l.r.faults.fail_next_appends(0);
    released(&l, txn);
}

#[test]
fn a_queued_commit_is_left_as_it_is_and_survives() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.faults.fail_next_appends(u32::MAX);
    l.r.commit(&a, txn, "text!").expect("the commit is queued");
    let queued = queue(&l);
    reload(&l, &a.label);
    assert_eq!(
        l.ended(),
        vec![],
        "the owner went when the commit was queued"
    );
    orphan(&l, txn);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::AlreadyQueued)]);
    assert_eq!(queue(&l), queued, "the queue unchanged");
    l.r.faults.fail_next_appends(0);
    wait_until("the commit to drain", || {
        l.r.status(txn) == Some(TxnStatus::Committed)
    });
}

#[test]
fn a_queued_abort_is_left_as_it_is_and_survives() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.faults.fail_next_appends(u32::MAX);
    l.r.abort(&a, txn).expect("the abort is queued");
    let queued = queue(&l);
    orphan(&l, txn);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::AlreadyQueued)]);
    assert_eq!(queue(&l), queued);
    l.r.faults.fail_next_appends(0);
    wait_until("the abort to drain", || {
        l.r.status(txn) == Some(TxnStatus::Aborted)
    });
}

#[test]
fn committed_aborted_and_uncommitted_are_already_terminal() {
    let l = life();
    let (a, committed) = owned(&l);
    l.r.commit(&a, committed, "text!").expect("commit");
    let aborted = txn_of(&l.r.prepare(&a, &l.r.p_head(&a, "text!")).expect("prepare"));
    l.r.abort(&a, aborted).expect("abort");
    let ended = txn_of(&l.r.prepare(&a, &l.r.p_head(&a, "text!")).expect("prepare"));
    reload(&l, &a.label);
    assert_eq!(l.r.status(ended), Some(TxnStatus::Uncommitted));
    let before = l.ended().len();
    for txn in [committed, aborted, ended] {
        orphan(&l, txn);
    }
    reload(&l, "doc-x");
    let mut got = l.ended().split_off(before);
    got.sort_by_key(|(t, _)| *t);
    let mut want: Vec<_> = [committed, aborted, ended]
        .into_iter()
        .map(|t| (t, OwnedEnd::AlreadyTerminal))
        .collect();
    want.sort_by_key(|(t, _)| *t);
    assert_eq!(got, want);
    assert_eq!(l.r.status(committed), Some(TxnStatus::Committed));
    assert_eq!(l.r.status(aborted), Some(TxnStatus::Aborted));
}

/// The bytes the degraded queues hold, across every document.
fn queue_bytes(l: &Life) -> usize {
    let g = l.r.c.writer.lock();
    g.degraded
        .values()
        .flatten()
        .map(|q| q.blobs.iter().map(|(_, t)| t.len()).sum::<usize>())
        .sum()
}

/// Orphan `txn`, sweep, and require `AlreadyTerminal` with its status and
/// the journal unchanged.
fn swept_as_already_terminal(l: &Life, txn: TxnId) {
    let status = l.r.status(txn);
    let len = l.r.journal_len();
    let before = l.ended().len();
    orphan(l, txn);
    reload(l, "doc-x");
    assert_eq!(
        l.ended().split_off(before),
        vec![(txn, OwnedEnd::AlreadyTerminal)]
    );
    assert_eq!(l.r.status(txn), status, "the status is unchanged");
    assert_eq!(l.r.journal_len(), len, "no record appended");
}

#[test]
fn discarded_and_resolved_are_already_terminal() {
    // Discarded: an uncommitted transaction resolved without a restore.
    let l = life();
    let (_, txn) = owned(&l);
    l.r.c.writer.record_uncommitted(txn).expect("uncommitted");
    l.r.c.writer.discard(txn).expect("discard");
    assert!(matches!(l.r.status(txn), Some(TxnStatus::Discarded { .. })));
    swept_as_already_terminal(&l, txn);

    // Resolved: a restore of its preimage commits and names it.
    let l = life();
    let a = l.r.page("doc-a", 1);
    let head = human_save(&l.r.c.writer, doc(&l.r.c), "text");
    let p = l.r.frame(&a, body(Some(head), "text", Some(&request_id())));
    let txn = txn_of(&l.r.prepare(&a, &p).expect("prepare"));
    l.r.c.writer.record_uncommitted(txn).expect("uncommitted");
    let restore = json!({
        "docKey": KEY, "parent": head, "preimage": "text",
        "source": { "from": "uncommittedPreimage", "txn": txn.0.to_string() },
    });
    let out =
        l.r.c
            .restore_prepare_framed(&l.r.pages, &a.label, &l.r.frame(&a, restore))
            .expect("restore");
    let out: Value = serde_json::to_value(out).unwrap();
    let by = txn_of(&out);
    l.r.commit(&a, by, out["reply"]["text"].as_str().unwrap())
        .expect("the restore commits");
    assert_eq!(l.r.status(txn), Some(TxnStatus::Resolved { by }));
    swept_as_already_terminal(&l, txn);
}

#[test]
fn a_full_byte_budget_still_queues_the_uncommitted_record() {
    let l = life();
    let (a, txn) = owned(&l);
    let other = owned_other(&l, &a, "elsewhere");
    l.r.faults.fail_next_appends(u32::MAX);
    l.r.commit(&a, other, "elsewhere!").expect("queued");
    l.r.c.writer.set_retention_budget(RetentionBudget {
        degraded_bytes: "elsewhere!".len(),
        ..RetentionBudget::default()
    });
    assert_eq!(
        queue_bytes(&l),
        "elsewhere!".len(),
        "the budget is exactly full"
    );
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    assert_eq!(
        queue_bytes(&l),
        "elsewhere!".len(),
        "the queue bytes unchanged"
    );
    let g = l.r.c.writer.lock();
    assert_eq!(
        g.reservations.get(&doc(&l.r.c)).map(|res| res.txn),
        Some(txn)
    );
    drop(g);
    l.r.faults.fail_next_appends(0);
    released(&l, txn);
}

#[test]
fn destroying_one_window_ends_only_its_transactions() {
    let l = life();
    let (a, ta) = owned(&l);
    let b = l.r.page("doc-b", 2);
    let tb = owned_other(&l, &b, "text");
    l.destroyed(&a.label);
    l.idle();
    assert_eq!(l.ended(), vec![(ta, OwnedEnd::Recorded)]);
    assert_eq!(l.r.status(tb), Some(TxnStatus::Prepared));
    let g = l.r.c.writer.lock();
    assert!(g.requests.owners.contains_key(&tb), "B's owner stays");
    assert_eq!(g.reservations.len(), 1, "B's reservation stays");
}

#[test]
fn cleanup_behind_a_held_save_is_ended_by_the_drainer_alone() {
    let l = life();
    let (a, txn) = owned(&l);
    held_save(&l.r);
    l.r.faults.fail_next_appends(1);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    released(&l, txn);
    wait_until("the held save to land", || pending(&l.r) == 0);
}

#[test]
fn a_corrupt_writer_ends_nothing_and_keeps_both_owners() {
    let l = life();
    let (a, t1) = owned(&l);
    let t2 = owned_other(&l, &a, "text");
    l.r.c.writer.lock().corrupt = Some("test".into());
    let len = l.r.journal_len();
    reload(&l, &a.label);
    let mut got = l.ended();
    got.sort_by_key(|(t, _)| *t);
    let mut want = vec![(t1, OwnedEnd::WriterStopped), (t2, OwnedEnd::WriterStopped)];
    want.sort_by_key(|(t, _)| *t);
    assert_eq!(got, want);
    assert_eq!(
        (l.r.sizes().2, l.r.sizes().4),
        (2, 2),
        "owners and reservations kept"
    );
    assert_eq!(l.r.journal_len(), len, "no terminal");
    assert_eq!(l.r.status(t1), Some(TxnStatus::Prepared));
}

#[test]
fn a_poisoned_journal_queues_and_a_reopen_records_uncommitted() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.c.writer.lock().journal.poison();
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    thread::sleep(Duration::from_millis(50));
    assert_eq!(
        l.r.sizes().4,
        1,
        "the drainer stops; the reservation is held"
    );
    let r = l.into_rig().reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn an_io_failure_clearing_after_three_retries_is_released_by_the_drainer() {
    let l = life();
    let (a, txn) = owned(&l);
    l.r.faults.fail_next_appends(4);
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);
    released(&l, txn);
}

#[test]
fn a_missing_reservation_is_counted_and_still_ended_uncommitted() {
    let l = life();
    let (a, txn) = owned(&l);
    let other = TxnId::new();
    {
        let mut g = l.r.c.writer.lock();
        let doc = g.proj.txns[&txn].doc;
        g.reservations.insert(doc, Reservation { txn: other });
    }
    reload(&l, &a.label);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!((l.r.sizes().2, breaks(&l)), (0, 1));
    let kept: Vec<TxnId> =
        l.r.c
            .writer
            .lock()
            .reservations
            .values()
            .map(|r| r.txn)
            .collect();
    assert_eq!(
        kept,
        vec![other],
        "another transaction's reservation is not released"
    );
    let r = l.into_rig().reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted), "durable");
}

#[test]
fn revocation_never_re_enters_the_writer_lock() {
    let l = std::sync::Arc::new(life());
    let (a, t1) = owned(&l);
    let t2 = owned_other(&l, &a, "text");
    let (done, finished) = mpsc::channel();
    let other = l.clone();
    thread::spawn(move || {
        other.started(&a.label);
        other.idle();
        done.send(()).unwrap();
    });
    finished
        .recv_timeout(Duration::from_secs(2))
        .expect("revocation finished within two seconds");
    assert_eq!(l.r.status(t1), Some(TxnStatus::Uncommitted));
    assert_eq!(l.r.status(t2), Some(TxnStatus::Uncommitted));
}

#[test]
fn a_legacy_prepared_txn_with_no_owner_is_refused_to_a_registered_page() {
    // The live prepare publishes no owner; only `authorize` refuses it.
    let l = life();
    let a = l.r.page("doc-a", 1);
    let legacy = body(None, "text", None);
    let txn =
        l.r.c
            .prepare(&legacy.to_string())
            .expect("legacy prepare")
            .txn;
    assert_eq!(l.r.status(txn), Some(TxnStatus::Prepared));
    assert!(!l.r.c.writer.lock().requests.owners.contains_key(&txn));
    let e =
        l.r.commit(&a, txn, "text!")
            .expect_err("a page that does not own it");
    assert_eq!(journal_code(&e), "INVALID_REQUEST");
    assert_eq!(l.r.status(txn), Some(TxnStatus::Prepared));
}
