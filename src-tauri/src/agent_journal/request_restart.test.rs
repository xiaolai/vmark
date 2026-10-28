// WI-AL2.2f — a request across a restart and after its transaction was resolved: a prepared-only transaction, a queued commit, a queued abort and an uncommitted one each retry after a reopen as staleIncarnation, never executable, the transaction recorded uncommitted; and a retry after a discard or a restore-resolution reports terminal with the transaction that ended it
//! R52.2 and R60 rules 1 and 5, through `Controller::prepare_framed`.

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::{body, doc, request_id, KEY};
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::test_support::human_save;

/// A rig with a page and a prepared request of `KEY`, then `at_shutdown`
/// done to its transaction.
fn fixture(at_shutdown: impl FnOnce(&Rig, &Page, TxnId)) -> (Rig, Page, String, TxnId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    at_shutdown(&r, &a, txn);
    (r, a, p, txn)
}

#[test]
fn restart_fixtures_retry_as_stale_incarnation() {
    let queued_commit = |r: &Rig, a: &Page, txn: TxnId| {
        r.faults.fail_next_fsyncs(1);
        let out = r
            .commit(a, txn, "text!")
            .expect("queued by its own failed fsync");
        assert_eq!(out["reply"]["durable"], json!(false));
    };
    let queued_abort = |r: &Rig, a: &Page, txn: TxnId| {
        r.faults.fail_next_fsyncs(1);
        let out = r.abort(a, txn).expect("queued by its own failed fsync");
        assert_eq!(out["reply"]["durable"], json!(false));
    };
    let uncommitted = |r: &Rig, _: &Page, txn: TxnId| {
        r.c.writer.record_uncommitted(txn).expect("uncommitted");
    };
    let fixtures = [
        ("prepared only", fixture(|_, _, _| {})),
        ("queued commit", fixture(queued_commit)),
        ("queued abort", fixture(queued_abort)),
        ("uncommitted", fixture(uncommitted)),
    ];
    for (name, (r, a, p, txn)) in fixtures {
        let r = r.reopen();
        let len = r.journal_len();
        let e = r.prepare(&a, &p).expect_err(name);
        assert_eq!(
            answer(&e),
            (
                "STALE_REQUEST".into(),
                "staleIncarnation".into(),
                Some(true)
            ),
            "{name}"
        );
        assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted), "{name}");
        assert_eq!(r.journal_len(), len, "{name}: the retry appends nothing");
        assert_eq!(
            r.sizes(),
            (0, 0, 0, 1, 0),
            "{name}: nothing in flight, fenced, owned or reserved"
        );
    }
}

#[test]
fn discarded_and_resolved_retry_report_terminal_by() {
    // Discarded: the uncommitted transaction resolved without a restore.
    let (r, a, p, txn) = fixture(|r, _, txn| {
        r.c.writer.record_uncommitted(txn).expect("uncommitted");
        r.c.writer.discard(txn).expect("discard");
    });
    let Some(TxnStatus::Discarded { by }) = r.status(txn) else {
        panic!("discarded")
    };
    let e = r.prepare(&a, &p).expect_err("a retry after the discard");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "terminal".into(), Some(false))
    );
    let request = &detail(&e)["request"];
    assert_eq!(
        (&request["status"], &request["by"]),
        (&json!("discarded"), &json!(by.0.to_string()))
    );

    // Resolved: a restore of its preimage commits and names it.
    let r = rig();
    let a = r.page("doc-a", 1);
    let head = human_save(&r.c.writer, doc(&r.c), "text");
    let p = r.frame(&a, body(Some(head), "text", Some(&request_id())));
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.c.writer.record_uncommitted(txn).expect("uncommitted");
    let restore = json!({
        "docKey": KEY, "parent": head, "preimage": "text",
        "source": { "from": "uncommittedPreimage", "txn": txn.0.to_string() },
    });
    let out =
        r.c.restore_prepare_framed(&r.pages, &a.label, &r.frame(&a, restore))
            .expect("restore");
    let out: Value = serde_json::to_value(out).unwrap();
    let by = txn_of(&out);
    r.commit(&a, by, out["reply"]["text"].as_str().unwrap())
        .expect("the restore commits");
    assert_eq!(r.status(txn), Some(TxnStatus::Resolved { by }));
    let e = r.prepare(&a, &p).expect_err("a retry after the resolution");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "terminal".into(), Some(false))
    );
    let request = &detail(&e)["request"];
    assert_eq!(
        (&request["status"], &request["by"]),
        (&json!("resolved"), &json!(by.0.to_string()))
    );
}
