// WI-AL2.2f — the sweep ends what a gone page owned: a destroyed window's prepared transaction is recorded uncommitted and its reservation released; a terminal already queued is left exactly as queued, its request answering staleGeneration from the revoked page and conflict from another; a committed transaction answers terminal committed with no owner entry; and each way an owned transaction can end (recorded, queued, already ended, writer stopped, invariant break) is reported, a writer bug counted
//! R52.3, R72, R74 and R79, through `Controller::sweep`.

use serde_json::json;

use crate::agent_journal::admission::admission_support::doc;
use crate::agent_journal::admission::owned::{OwnedBreak, OwnedEnd};
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::admission::requests::Owner;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;

/// The queued terminal records of `KEY`'s document, as text.
fn queue(r: &Rig) -> Vec<String> {
    let d = doc(&r.c);
    let g = r.c.writer.lock();
    g.degraded
        .get(&d)
        .map(|q| {
            q.iter()
                .map(|q| format!("{:?} {:?}", q.txn, q.record))
                .collect()
        })
        .unwrap_or_default()
}

fn breaks(r: &Rig) -> u64 {
    r.c.writer.lock().requests.owner_invariant_breaks
}

#[test]
fn destroy_and_sweep_release_the_reservation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    let next = r.page("doc-b", 2);
    let e = r
        .prepare(&next, &r.p_head(&next, "text"))
        .expect_err("the document is held");
    assert_eq!(state(&e), "notAdmitted");

    r.abandon(&a.label, &r.p_head(&a, "text"))
        .expect("fence an id under A");
    assert_eq!(r.sizes().1, 2);
    r.pages.destroy(&a.label);
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(
        r.sizes(),
        (0, 1, 0, 1, 0),
        "A's fence purged with its owner and reservation; next's stays"
    );
    r.prepare(&next, &r.p_head(&next, "text"))
        .expect("the document is free");
    assert_eq!(state(&r.prepare(&a, &p).unwrap_err()), "staleGeneration");
}

#[test]
fn queued_terminal_revoke_and_sweep_stays_stale_generation_queue_unchanged() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.page("doc-b", 2);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.faults.fail_next_appends(u32::MAX);
    let out = r.commit(&a, txn, "text!").expect("the commit is queued");
    assert_eq!(out["reply"]["durable"], json!(false));
    let queued = queue(&r);
    assert_eq!(queued.len(), 1);
    assert_eq!(r.sizes().2, 0, "the owner goes when the terminal is queued");

    let e = r.prepare_as(&b.label, &p).expect_err("A's payload from B");
    assert_eq!(state(&e), "conflict");
    let request = &detail(&e)["request"];
    assert!(
        request.get("status").is_none() && request.get("terminal").is_none(),
        "{request}"
    );
    assert_eq!(state(&r.abandon(&b.label, &p).unwrap_err()), "conflict");

    r.pages.started(&a.label);
    assert_eq!(r.c.sweep(&r.pages), vec![], "nothing owned is left");
    for e in [
        r.prepare(&a, &p).unwrap_err(),
        r.abandon(&a.label, &p).unwrap_err(),
    ] {
        assert_eq!(
            answer(&e),
            ("STALE_REQUEST".into(), "staleGeneration".into(), Some(true))
        );
    }
    assert_eq!(queue(&r), queued, "the queue unchanged");
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));
    r.faults.fail_next_appends(0);
}

#[test]
fn committed_txn_without_owner_entry_reports_terminal_committed() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.commit(&a, txn, "text!").expect("commit");
    assert_eq!(r.sizes().2, 0, "the owner went when the terminal landed");
    let e = r
        .prepare(&a, &p)
        .expect_err("a duplicate from its live owner");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "terminal".into(), Some(false))
    );
    assert_eq!(detail(&e)["request"]["status"], json!("committed"));
    assert_eq!(r.c.sweep(&r.pages), vec![]);
}

#[test]
fn the_sweep_reports_each_way_an_owned_transaction_ends() {
    let gone = Owner {
        label: "gone".into(),
        generation: u64::MAX,
    };

    // The writer is corrupt: nothing ends, the owner is kept for a reopen.
    let r = rig();
    let a = r.page("doc-a", 1);
    let txn = txn_of(&r.prepare(&a, &r.p_head(&a, "text")).expect("prepare"));
    r.c.writer.lock().corrupt = Some("test".into());
    r.pages.started(&a.label);
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::WriterStopped)]);
    assert_eq!(
        (r.status(txn), r.sizes().2, r.sizes().4),
        (Some(TxnStatus::Prepared), 1, 1)
    );
    assert_eq!(breaks(&r), 0);

    // Poisoned: queued, the reservation held; a reopen records uncommitted.
    let r = rig();
    let a = r.page("doc-a", 1);
    let txn = txn_of(&r.prepare(&a, &r.p_head(&a, "text")).expect("prepare"));
    r.c.writer.lock().journal.poison();
    r.pages.started(&a.label);
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Queued)]);
    assert_eq!((r.sizes().2, r.sizes().4), (0, 1));
    let r = r.reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));

    // Its reservation gone: a writer bug, counted, and still ended uncommitted.
    let r = rig();
    let a = r.page("doc-a", 1);
    let txn = txn_of(&r.prepare(&a, &r.p_head(&a, "text")).expect("prepare"));
    r.c.writer.lock().reservations.clear();
    r.pages.started(&a.label);
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!((r.sizes().2, breaks(&r)), (0, 1));

    // An owner naming no transaction, and one whose transaction ended.
    let r = rig();
    let a = r.page("doc-a", 1);
    let done = txn_of(&r.prepare(&a, &r.p_head(&a, "text")).expect("prepare"));
    r.commit(&a, done, "text!").expect("commit");
    let unknown = TxnId::new();
    {
        let mut g = r.c.writer.lock();
        g.requests.owners.insert(unknown, gone.clone());
        g.requests.owners.insert(done, gone);
    }
    let mut ended = r.c.sweep(&r.pages);
    ended.sort_by_key(|(t, _)| *t);
    let mut want = vec![
        (unknown, OwnedEnd::Invariant(OwnedBreak::UnknownTxn)),
        (done, OwnedEnd::AlreadyTerminal),
    ];
    want.sort_by_key(|(t, _)| *t);
    assert_eq!(ended, want);
    assert_eq!((r.sizes().2, breaks(&r)), (0, 1));
    assert_eq!(r.status(done), Some(TxnStatus::Committed));
}
