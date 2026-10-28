// WI-AL2.2f — a retried request is answered by its state: executable (the stored reply, appending nothing), terminalPending (a queued terminal), terminal (a durable one) or unavailable (an unhealthy writer); a caller that applies only an executable answer applies each request at most once; a lost reply across a restart is staleIncarnation; and a request id reused for other content is a conflict
//! R52 and R60 rule 5, through `Controller::prepare_framed`.

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::body;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::command_error::CommandError;

/// What a caller is told about a retried prepare.
#[derive(Debug, PartialEq)]
enum Seen {
    Executable,
    TerminalPending(String),
    Terminal(String),
    Unavailable,
    Other(String),
}

fn seen(out: &Result<Value, CommandError>) -> Seen {
    let Err(e) = out else { return Seen::Executable };
    let request = &detail(e)["request"];
    let field = |k: &str| request[k].as_str().unwrap_or("").to_owned();
    match state(e).as_str() {
        "terminalPending" => Seen::TerminalPending(field("terminal")),
        "terminal" => Seen::Terminal(field("status")),
        "unavailable" => Seen::Unavailable,
        other => Seen::Other(other.to_owned()),
    }
}

/// Send `p` as a caller does: it applies the change only on an
/// executable answer.
fn send(r: &Rig, page: &Page, p: &str, applies: &mut u32) -> Seen {
    let out = r.prepare(page, p);
    let s = seen(&out);
    if s == Seen::Executable {
        *applies += 1;
    }
    s
}

/// A page on a fresh rig and a prepared request of `KEY`.
fn prepared() -> (Rig, Page, String, TxnId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    (r, a, p, txn)
}

#[test]
fn duplicate_requests_answer_each_of_four_states_with_zero_extra_apply() {
    // Executable: the first reply was lost, so the retry is what is applied.
    let (r, a, p, txn) = prepared();
    let mut applies = 0;
    let len = r.journal_len();
    assert_eq!(send(&r, &a, &p, &mut applies), Seen::Executable);
    assert_eq!(r.journal_len(), len, "the retry appends nothing");
    assert_eq!(applies, 1);
    r.commit(&a, txn, "text!")
        .expect("the one applied change commits");

    // TerminalPending: applied and committed, the commit's append failed.
    let (r, a, p, txn) = prepared();
    let mut applies = 1;
    r.faults.fail_next_appends(u32::MAX);
    r.commit(&a, txn, "text!").expect("the commit is queued");
    assert_eq!(
        send(&r, &a, &p, &mut applies),
        Seen::TerminalPending("committed".into())
    );
    assert_eq!(applies, 1, "zero extra applies");
    r.faults.fail_next_appends(0);

    // Terminal: applied and committed durably.
    let (r, a, p, txn) = prepared();
    let mut applies = 1;
    r.commit(&a, txn, "text!").expect("commit");
    assert_eq!(
        send(&r, &a, &p, &mut applies),
        Seen::Terminal("committed".into())
    );
    assert_eq!(applies, 1, "zero extra applies");

    // Unavailable: applied, then the writer was poisoned.
    let (r, a, p, txn) = prepared();
    let mut applies = 1;
    r.c.writer.lock().journal.poison();
    assert_eq!(send(&r, &a, &p, &mut applies), Seen::Unavailable);
    assert_eq!(applies, 1, "zero extra applies");
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));
}

#[test]
fn commit_append_failure_retry_is_terminal_pending_with_zero_applies() {
    let (r, a, p, txn) = prepared();
    let mut applies = 1;
    r.faults.fail_next_appends(u32::MAX);
    let out = r
        .commit(&a, txn, "text!")
        .expect("a clean append failure queues the commit");
    assert_eq!(out["reply"]["durable"], json!(false));
    let len = r.journal_len();
    let e = r
        .prepare(&a, &p)
        .expect_err("a retry before the queue drains");
    assert_eq!(
        answer(&e),
        (
            "STALE_REQUEST".into(),
            "terminalPending".into(),
            Some(false)
        )
    );
    assert_eq!(detail(&e)["request"]["terminal"], json!("committed"));
    assert_eq!(seen(&Err(e)), Seen::TerminalPending("committed".into()));
    assert_eq!(
        (r.journal_len(), r.status(txn)),
        (len, Some(TxnStatus::Prepared))
    );
    assert_eq!(applies, 1);

    r.faults.fail_next_appends(0);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while r.status(txn) != Some(TxnStatus::Committed) {
        assert!(
            std::time::Instant::now() < deadline,
            "the queued commit never drained"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    assert_eq!(
        send(&r, &a, &p, &mut applies),
        Seen::Terminal("committed".into())
    );
    assert_eq!(applies, 1);
}

#[test]
fn poison_through_another_doc_makes_a_retry_unavailable() {
    let (r, a, p, txn) = prepared();
    let mut other = body(None, "elsewhere", None);
    other["docKey"] = json!("path:/notes/other.md");
    let q = r.frame(&a, other);
    let other_txn = txn_of(&r.prepare(&a, &q).expect("prepare the other document"));
    r.faults.fail_next_fsyncs(1);
    let _ = r.commit(&a, other_txn, "elsewhere!");
    assert!(
        r.c.writer.lock().healthy().is_err(),
        "the other document's fsync poisoned the writer"
    );

    let mut applies = 1;
    let e = r
        .prepare(&a, &p)
        .expect_err("a retry against the poisoned writer");
    assert_eq!(
        answer(&e),
        ("JOURNAL_DEGRADED".into(), "unavailable".into(), Some(true))
    );
    assert_eq!(send(&r, &a, &p, &mut applies), Seen::Unavailable);
    assert_eq!(applies, 1);
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));
    let r = r.reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn lost_reply_across_restart_is_stale_incarnation() {
    let (r, a, p, txn) = prepared();
    let r = r.reopen();
    let len = r.journal_len();
    let mut applies = 0;
    assert_eq!(
        send(&r, &a, &p, &mut applies),
        Seen::Other("staleIncarnation".into())
    );
    let e = r.prepare(&a, &p).expect_err("the lost reply's retry");
    assert_eq!(
        answer(&e),
        (
            "STALE_REQUEST".into(),
            "staleIncarnation".into(),
            Some(true)
        )
    );
    assert_eq!(applies, 0, "never applied");
    assert_eq!(
        r.status(txn),
        Some(TxnStatus::Uncommitted),
        "the reopen ended it"
    );
    assert_eq!(r.journal_len(), len, "the retry appends nothing");
}

#[test]
fn reused_id_with_other_content_is_conflict() {
    let (r, a, p, txn) = prepared();
    let id = serde_json::from_str::<Value>(&p).unwrap()["requestId"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = |r: &Rig| r.frame(&a, body(None, "other text", Some(&id)));

    let (len, sizes) = (r.journal_len(), r.sizes());
    let e = r
        .prepare(&a, &other(&r))
        .expect_err("the id under other content");
    assert_eq!(
        answer(&e),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
    assert!(
        detail(&e)["request"].get("status").is_none(),
        "the first request's state is not told"
    );
    assert_eq!((r.journal_len(), r.sizes()), (len, sizes));
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));

    // Across incarnations: the receipt outlives the writer that took it.
    let r = r.reopen();
    let len = r.journal_len();
    let e = r
        .prepare(&a, &other(&r))
        .expect_err("the id reused after a restart");
    assert_eq!(
        answer(&e),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
    assert_eq!(r.journal_len(), len, "nothing admitted");
}
