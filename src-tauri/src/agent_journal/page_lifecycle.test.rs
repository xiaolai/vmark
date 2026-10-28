// WI-AL2.2h — a page's lifecycle through the hook, destroy and replacing-registration entries and the cleanup worker: a revoked owner's commit is STALE_PAGE and the worker's pass records the transaction uncommitted, never aborted; destroy before begin or between begin and admission is staleGeneration with nothing reserved; a reload with a prepared transaction ends it uncommitted and settles the document; a delayed old-generation prepare, a registration after destroy, and an old generation after a rebuilt window's Started are all stale; two Starteds leave the first generation dead; the entries return at once while a slow append or a held writer lock blocks the pass; label churn returns the table to its open labels; three reloads with fences are purged before the next insert; a replacing registration signals the worker
//! R66, R67, R73, R80, R81 and R95, through `page_events` with the
//! production sweep pass.

use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use crate::agent_journal::admission::lifecycle_support::{life, life_held, life_inline, Life};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::page_events::register_page;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::projection::TxnStatus;

const STALE: (&str, &str, Option<bool>) = ("STALE_REQUEST", "staleGeneration", Some(true));
const TWO_SECONDS: Duration = Duration::from_secs(2);

fn stale(e: &crate::command_error::CommandError) {
    let (code, st, unc) = answer(e);
    assert_eq!((code.as_str(), st.as_str(), unc), STALE);
}

/// A prepared transaction of `KEY` owned by page 1 in `doc-a`.
fn owned(l: &Life) -> (Page, crate::agent_journal::ids::TxnId) {
    let a = l.r.page("doc-a", 1);
    let txn = txn_of(&l.r.prepare(&a, &l.r.p_head(&a, "text")).expect("prepare"));
    (a, txn)
}

#[test]
fn revoked_owner_commit_is_stale_page_and_the_worker_records_uncommitted() {
    let l = life_held();
    let (a, txn) = owned(&l);
    l.started(&a.label);
    assert_eq!(l.spawns(), 1, "the hook entry signalled the worker");
    let e = l.r.commit(&a, txn, "text!").expect_err("a revoked owner");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(l.r.status(txn), Some(TxnStatus::Prepared));

    l.run_held();
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(
        l.r.status(txn),
        Some(TxnStatus::Uncommitted),
        "never aborted"
    );
    assert_eq!(l.r.sizes(), (0, 0, 0, 1, 0));
}

#[test]
fn destroy_before_begin_is_stale_generation_nothing_reserved() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    let p = l.r.p_head(&a, "text");
    l.destroyed(&a.label);
    l.idle();
    stale(&l.r.prepare(&a, &p).expect_err("a destroyed window"));
    assert_eq!(l.r.sizes().4, 0, "nothing reserved");
    assert_eq!(l.r.pages.labels(), 0);
}

#[test]
fn destroy_between_begin_and_admission_is_stale_generation_nothing_reserved() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    let p = l.r.p_head(&a, "text");
    let (held, go) = hold_original(&l.r, &a, &p);
    l.destroyed(&a.label);
    l.idle();
    go.send(()).unwrap();
    stale(&held.join().unwrap().expect_err("revoked before admission"));
    let (inflight, _, owners, receipts, reservations) = l.r.sizes();
    assert_eq!((inflight, owners, receipts, reservations), (0, 0, 0, 0));
    let late = l.r.prepare(&a, &p).expect_err("the id again");
    stale(&late);
}

#[test]
fn reload_with_a_prepared_txn_ends_uncommitted_and_schedules_the_drain() {
    let l = life();
    let (a, txn) = owned(&l);
    held_save(&l.r);
    l.started(&a.label);
    l.idle();
    assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(pending(&l.r), 0, "the held save is linearized");
    assert_eq!(l.r.sizes().4, 0, "the reservation is released");
    assert_eq!(l.r.pages.labels(), 1, "the label stays open");
}

#[test]
fn a_delayed_old_generation_prepare_after_started_is_stale_generation() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    let p = l.r.p_head(&a, "text");
    l.started(&a.label);
    l.idle();
    stale(&l.r.prepare(&a, &p).expect_err("an old generation"));
    assert_eq!(l.r.sizes().4, 0);
}

#[test]
fn a_registration_before_started_is_revoked_and_its_prepared_txn_ends_uncommitted() {
    let l = life();
    let (a, txn) = owned(&l);
    l.started(&a.label);
    l.idle();
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(l.r.pages.registrations(&a.label), 0);
}

#[test]
fn destroy_then_a_delayed_registration_is_stale_generation_and_the_label_stays_closed() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    l.destroyed(&a.label);
    let late = register_page(
        &l.r.pages,
        &l.worker,
        Some(&l.r.c.writer),
        &a.label,
        &ident(2),
        None,
        l.pass(),
    )
    .expect_err("the window is gone");
    assert_eq!(journal_code(&late), "STALE_REQUEST");
    assert_eq!(
        (
            detail(&late)["state"].as_str(),
            detail(&late)["uncertain"].as_bool()
        ),
        (Some("staleGeneration"), Some(true))
    );
    assert_eq!(l.r.pages.labels(), 0, "registration never reopens a label");
    l.idle();
}

#[test]
fn rebuilt_main_started_reopens_and_the_old_generation_is_stale() {
    let l = life();
    let old = l.r.page("main", 1);
    let p = l.r.p_head(&old, "text");
    l.destroyed("main");
    l.started("main");
    let new = l.r.register("main", 2);
    l.idle();
    stale(
        &l.r.prepare(&old, &p)
            .expect_err("the old window's generation"),
    );
    l.r.prepare(&new, &l.r.p_head(&new, "text"))
        .expect("the rebuilt window writes");
}

#[test]
fn two_starteds_with_no_registration_between_leave_the_first_generation_dead() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    let p = l.r.p_head(&a, "text");
    l.started(&a.label);
    l.started(&a.label);
    l.idle();
    let gen: u64 = a.generation.parse().unwrap();
    assert!(!l.r.pages.is_live(gen));
    stale(&l.r.prepare(&a, &p).expect_err("the first generation"));
}

/// Run `f` on another thread; fail unless it returns within two seconds.
fn returns_at_once(f: impl FnOnce() + Send + 'static) {
    let (done, finished) = mpsc::channel();
    thread::spawn(move || {
        f();
        done.send(()).unwrap();
    });
    finished
        .recv_timeout(TWO_SECONDS)
        .expect("the entry waited on the writer lock");
}

#[test]
fn the_hook_returns_at_once_while_a_slow_append_holds_the_writer_lock() {
    let l = Arc::new(life());
    let (a, txn) = owned(&l);
    let (inside, reached) = mpsc::channel();
    let (go, wait) = mpsc::channel::<()>();
    let wait = std::sync::Mutex::new(Some((inside, wait)));
    l.r.faults.set_append_hook(Some(Arc::new(move |_| {
        if let Some((inside, wait)) = wait.lock().unwrap().take() {
            inside.send(()).unwrap();
            wait.recv().unwrap();
        }
    })));
    let committing = {
        let l = l.clone();
        let a = a.clone();
        thread::spawn(move || l.r.commit(&a, txn, "text!").map(|_| ()))
    };
    reached
        .recv_timeout(TWO_SECONDS)
        .expect("the append is held");
    let other = l.clone();
    returns_at_once(move || other.started("doc-b"));
    go.send(()).unwrap();
    committing.join().unwrap().expect("commit");
    l.idle();
    assert_eq!(l.r.status(txn), Some(TxnStatus::Committed));
}

#[test]
fn writer_held_main_thread_rendezvous_needs_no_writer_lock() {
    let l = Arc::new(life());
    let (a, txn) = owned(&l);
    let g = l.r.c.writer.lock();
    let other = l.clone();
    let label = a.label.clone();
    returns_at_once(move || {
        other.started(&label);
        other.destroyed(&label);
    });
    assert_eq!(
        l.r.pages.labels(),
        0,
        "the table changed under the held lock"
    );
    drop(g);
    l.idle();
    assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn five_hundred_label_churn_returns_the_table_to_open_labels() {
    let l = life();
    l.started("main");
    for i in 0..500 {
        let label = format!("doc-{i}");
        l.started(&label);
        l.r.register(&label, i + 1);
        l.destroyed(&label);
    }
    l.idle();
    assert_eq!(l.r.pages.labels(), 1, "only main is open");
    assert!(l.r.pages.live_generations().is_empty());
}

#[test]
fn three_reloads_with_fences_then_begin_purges_before_insert() {
    // The worker's passes are held: only the insert's purge can clear them.
    let l = life_held();
    for n in 1..=3 {
        let page = l.r.page("doc-a", n);
        l.r.abandon(&page.label, &l.r.p_head(&page, "text"))
            .expect("fence an unknown id");
        assert_eq!(
            l.r.sizes(),
            (0, 1, 0, 0, 0),
            "reload {n}: the earlier dead fence was purged before this insert"
        );
        l.started("doc-a");
    }
    let page = l.r.register("doc-a", 4);
    l.r.prepare(&page, &l.r.p_head(&page, "text"))
        .expect("begin");
    assert_eq!(l.r.sizes(), (0, 0, 1, 1, 1), "purged before the insert");
    assert_eq!(l.spawns(), 1, "one worker task for all three reloads");
}

#[test]
fn a_replacing_registration_signals_the_worker() {
    let l = life();
    let (a, txn) = owned(&l);
    let b = l.replace(&a, 2);
    assert_ne!(b.generation, a.generation);
    l.idle();
    assert_eq!(l.spawns(), 1);
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn each_entry_changes_the_table_before_it_signals_the_worker() {
    // The worker runs inline: a pass started before the table changed
    // would find every owner live and end nothing.
    let l = life_inline();
    let (a, t1) = owned(&l);
    l.started(&a.label);
    assert_eq!(l.ended(), vec![(t1, OwnedEnd::Recorded)], "page load");

    let a = l.r.register("doc-a", 2);
    let t2 = txn_of(&l.r.prepare(&a, &l.r.p_head(&a, "text!")).expect("prepare"));
    l.replace(&a, 3);
    assert_eq!(l.ended()[1..], [(t2, OwnedEnd::Recorded)], "replacement");

    let b = l.r.register("doc-a", 4);
    let t3 = txn_of(&l.r.prepare(&b, &l.r.p_head(&b, "text!")).expect("prepare"));
    l.destroyed(&b.label);
    assert_eq!(l.ended()[2..], [(t3, OwnedEnd::Recorded)], "destroy");
}
