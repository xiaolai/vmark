//! The degraded-queue budget is one occupancy: queued captures, queued
//! terminal records and the terminal slot every open reservation holds.
//! A direct `Writer::prepare` is admitted under the writer lock like a
//! controlled one, so no caller can reserve past the budget.

use std::sync::{Arc, Barrier};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::capture_tests::{capture_payload, journal_code, setup};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::prepare_req;
use crate::agent_journal::writer::RetentionBudget;

fn budget(entries: usize) -> RetentionBudget {
    RetentionBudget {
        degraded_entries: entries,
        degraded_bytes: 1 << 20,
        window_bases: 16,
    }
}

#[test]
fn a_direct_prepare_is_refused_past_the_reservation_budget() {
    let (_dir, w, _c, _) = setup();
    w.set_retention_budget(budget(1));
    w.prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
        .expect("the first reservation fits");
    let gen = w.snapshot().generation;
    let err = w
        .prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
        .unwrap_err();
    assert_eq!(err, TxnError::JournalDegraded);
    assert_eq!(w.snapshot().generation, gen, "nothing appended");
}

#[test]
fn concurrent_prepares_on_different_documents_never_overfill_the_budget() {
    let (_dir, w, _c, _) = setup();
    w.set_retention_budget(budget(1));
    let bar = Arc::new(Barrier::new(4));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let (w, bar) = (w.clone(), bar.clone());
            std::thread::spawn(move || {
                bar.wait();
                w.prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
            })
        })
        .collect();
    let ok = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .filter(Result::is_ok)
        .count();
    assert_eq!(ok, 1, "exactly one reservation fits a budget of one");
}

/// A queued terminal record keeps its reservation until it drains, but the
/// two are one slot: the record IS the terminal the reservation held room
/// for, so it is not counted twice.
#[test]
fn a_queued_terminal_record_and_its_reservation_take_one_slot() {
    let (_dir, w, c, faults) = setup();
    w.set_retention_budget(budget(2));
    let p = w
        .prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
        .expect("reservation");
    faults.fail_next_appends(1_000);
    let aborted = w.abort(p.txn, "failed").expect("queued, not refused");
    assert!(!aborted.durable, "the terminal record is queued");
    c.capture(&capture_payload("b", "main/t1", None, "x", &Actor::Human))
        .expect("one slot is left beside the queued terminal record");
    let err = c
        .capture(&capture_payload("b", "main/t1", None, "y", &Actor::Human))
        .unwrap_err();
    assert_eq!(journal_code(&err), "JOURNAL_DEGRADED");
}

/// A commit whose record must be queued is refused when its text would
/// take the queue past the byte budget: the transaction stays open and its
/// caller ends it `uncommitted`, which holds no text.
#[test]
fn a_queued_commit_past_the_byte_budget_is_refused_and_ends_uncommitted() {
    use crate::agent_journal::projection::TxnStatus;
    use crate::agent_journal::test_support::barrier_commit_req;
    let (_dir, w, _c, faults) = setup();
    w.set_retention_budget(RetentionBudget {
        degraded_bytes: 16,
        ..budget(8)
    });
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::None))
        .expect("reservation");
    faults.fail_next_appends(1_000);
    let post = "more than sixteen bytes 中文";
    let req = barrier_commit_req(&w, doc, post, vec![], &ReviewOp::None);
    let err = w.commit(p.txn, req).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_DEGRADED");
    let queued_bytes = |w: &crate::agent_journal::writer::Writer| -> usize {
        let g = w.lock();
        let all = g.degraded.values().flatten();
        all.flat_map(|q| q.blobs.iter().map(|(_, t)| t.len())).sum()
    };
    assert_eq!(queued_bytes(&w), 0, "nothing queued past the budget");
    assert_eq!(w.lock().proj.txns[&p.txn].status, TxnStatus::Prepared);
    let ended = w.record_uncommitted(p.txn).expect("queued, not refused");
    assert!(!ended.durable);
    assert!(queued_bytes(&w) <= 16, "the declared byte budget holds");
}

/// More unpinned windows than the window budget can name leave only a
/// session flag. Once the app reports which app windows are still alive,
/// the flag becomes exactly those labels (any of them may hold an
/// unpinned base), so the collector resumes when they have all closed.
#[test]
fn an_unpinned_overflow_clears_once_every_window_alive_at_reconcile_has_closed() {
    use std::collections::BTreeSet;
    let (_dir, w, _c, _) = setup();
    w.set_retention_budget(RetentionBudget {
        window_bases: 1,
        ..budget(8)
    });
    genesis_base(&w, "main/t1@a");
    genesis_base(&w, "doc-2/t1@b"); // unpinned by name
    genesis_base(&w, "doc-3/t1@c"); // unpinned by app window label
    genesis_base(&w, "doc-4/t1@d"); // overflow: no name or label kept
    assert!(w.lock().unpinned_overflow);
    for label in ["doc-2", "doc-3", "doc-4"] {
        w.release_window_label(label);
    }
    assert!(
        w.lock().unpinned_windows(),
        "the overflow is not attributed"
    );
    let live: BTreeSet<String> = ["main".to_string()].into();
    w.reconcile_live_windows(&live);
    assert!(
        w.lock().unpinned_windows(),
        "main was alive and may hold an unpinned base"
    );
    w.release_window_label("main");
    assert!(
        !w.lock().unpinned_windows(),
        "every window alive at reconcile closed: the collector may run"
    );
}

/// Reconciling with more live windows than the budget can name keeps the
/// overflow flag: failing closed defers the collector, never loses text.
#[test]
fn an_unpinned_overflow_stays_while_more_windows_live_than_the_budget_names() {
    use std::collections::BTreeSet;
    let (_dir, w, _c, _) = setup();
    w.set_retention_budget(RetentionBudget {
        window_bases: 1,
        ..budget(8)
    });
    for name in ["main/t1@a", "doc-2/t1@b", "doc-3/t1@c", "doc-4/t1@d"] {
        genesis_base(&w, name);
    }
    let live: BTreeSet<String> = ["main", "doc-4"].map(String::from).into();
    w.reconcile_live_windows(&live);
    assert!(w.lock().unpinned_overflow);
    w.reconcile_live_windows(&BTreeSet::new());
    assert!(!w.lock().unpinned_windows(), "no window is alive at all");
}

#[test]
fn a_capture_is_refused_when_an_open_reservation_holds_the_last_slot() {
    let (_dir, w, c, faults) = setup();
    w.set_retention_budget(budget(2));
    w.prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
        .expect("reservation");
    faults.fail_next_appends(1_000);
    c.capture(&capture_payload("b", "main/t1", None, "x", &Actor::Human))
        .expect("one capture fits beside the reservation");
    let err = c
        .capture(&capture_payload("b", "main/t1", None, "y", &Actor::Human))
        .unwrap_err();
    assert_eq!(journal_code(&err), "JOURNAL_DEGRADED");
}

fn genesis_base(w: &crate::agent_journal::writer::Writer, name: &str) {
    w.register_window_base(
        name,
        DocId::new(),
        crate::agent_journal::record::ObservedRef::Genesis,
    );
}

#[test]
fn windows_unpinned_past_every_budget_stop_deferring_the_collector_once_their_app_window_closes() {
    let (_dir, w, _c, _) = setup();
    w.set_retention_budget(RetentionBudget {
        window_bases: 1,
        ..budget(8)
    });
    genesis_base(&w, "main/t1@a");
    genesis_base(&w, "doc-2/t1@b"); // unpinned by name
    genesis_base(&w, "doc-3/t1@c"); // unpinned by app window label
    genesis_base(&w, "doc-3/t2@d");
    assert!(w.lock().unpinned_windows());
    w.clear_window_base("doc-2/t1@b");
    assert!(
        w.lock().unpinned_windows(),
        "doc-3 still holds unpinned bases"
    );
    w.release_window_label("doc-3");
    assert!(
        !w.lock().unpinned_windows(),
        "every unpinned window is closed: the collector may run again"
    );
}

#[test]
fn releasing_an_app_window_label_drops_exactly_its_bases_and_they_never_return() {
    let (_dir, w, _c, _) = setup();
    for name in [
        "doc-1/t1@a",
        "doc-1/t2@b",
        "doc-10/t1@c",
        "main/t1@d",
        "doc-1",
    ] {
        genesis_base(&w, name);
    }
    w.release_window_label("doc-1");
    let left: Vec<String> = w.lock().window_bases.keys().cloned().collect();
    assert_eq!(
        left,
        ["doc-10/t1@c", "main/t1@d"],
        "a label is matched whole"
    );
    genesis_base(&w, "doc-1/t1@a");
    assert!(
        !w.lock().window_bases.contains_key("doc-1/t1@a"),
        "a late capture does not register a released name again"
    );
    w.release_window_label("doc-1"); // idempotent
    w.release_window_label("");
    assert_eq!(w.lock().window_bases.len(), 2);
}

/// A capture in flight when its app window is destroyed registers a tab
/// name the window never held before: the release must still refuse it, or
/// the stale base stays pinned until restart. A label built again (`main`)
/// is reopened first (`writer_reopen.test.rs`).
#[test]
fn a_capture_landing_after_its_app_window_closed_registers_no_new_name() {
    let (_dir, w, _c, _) = setup();
    w.release_window_label("doc-3"); // nothing registered yet
    genesis_base(&w, "doc-3/t1@x");
    genesis_base(&w, "doc-30/t1@y");
    let left: Vec<String> = w.lock().window_bases.keys().cloned().collect();
    assert_eq!(left, ["doc-30/t1@y"], "only the live window registers");
}
