// WI-AL2.2a — a request id makes a prepare retry-safe: an identical retry while its transaction is open gets the first reply back byte for byte with nothing appended (dirty baseline, pending linearization, no baseline, uncertified fallback, restore), a different payload under the same id is refused, a consumed capture under a new id is refused while the same capture under its own id is a retry (also after another window writes), and the live projection, receipts included, equals the replayed one
//! R44 rule 7, R50 rule 3 and R103's retry clauses, through the controller.

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::*;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::{config, diff_edit, human, human_save, observe, tmp};
use crate::agent_journal::writer::certificate::support::{cert, with_pre_hash};
use crate::agent_journal::writer::{ObserveRequest, Writer};

fn reopened_proj(dir: &std::path::Path) -> crate::agent_journal::projection::Projection {
    let (w, _) = Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen");
    let p = w.lock().proj.clone();
    p
}

/// Prepare `payload` twice; the second is answered from the receipt.
fn prepare_twice(c: &Controller, payload: &Value) -> Value {
    let raw = payload.to_string();
    let first = c.prepare(&raw).expect("first prepare");
    let len = c.writer.journal_len();
    let generation = c.writer.generation();
    let second = c.prepare(&raw).expect("the identical retry");
    assert_eq!(second, first, "the stored reply");
    assert_eq!(c.writer.journal_len(), len, "nothing appended");
    assert_eq!(c.writer.generation(), generation);
    serde_json::to_value(first).unwrap()
}

#[test]
fn live_projection_equals_replay_including_requests_after_an_immediate_retry() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "seed\n");
    observe(&c.writer, d, "seed\nsaved\n", None);

    let req = request_id();
    let payload = body(Some(head), "seed\nsaved\nunsaved\n", Some(&req));
    let first = c.prepare(&payload.to_string()).expect("prepare");
    let second = c.prepare(&payload.to_string()).expect("retry prepare");
    assert_eq!(first, second);
    assert_ne!(c.writer.head(d), Some(head));
    c.abort(&first.txn.to_string(), "edited").expect("abort");
    close_epoch(&c.writer, d);

    let live_proj = c.writer.lock().proj.clone();
    assert_eq!(live_proj.requests.len(), 1);
    assert_eq!(live_proj.requests.keys().next().unwrap().to_string(), req);
    drop(c);
    assert_eq!(reopened_proj(dir.path()), live_proj, "live proj = replay");
}

#[test]
fn an_immediate_duplicate_gets_the_exact_reply_in_every_prepare_shape() {
    // Dirty baseline.
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let r = prepare_twice(&c, &body(Some(head), "a\nb\n", Some(&request_id())));
    assert!(!r["baseline"].is_null());

    // Pending linearization, no baseline.
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "a\n");
    observe(&c.writer, d, "a\nb\n", None);
    let r = prepare_twice(&c, &body(Some(head), "a\nb\n", Some(&request_id())));
    assert!(r["baseline"].is_null());

    // No baseline, nothing pending: the direct path.
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let r = prepare_twice(&c, &body(Some(head), "a\n", Some(&request_id())));
    assert!(r["baseline"].is_null());

    // An uncertified fallback: the certificate is not bound to the parent.
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let mut p = body(Some(head), "a\n", Some(&request_id()));
    p["certificate"] = with_pre_hash(cert("a\n", "a!\n", &[diff_edit("a\n", "a!\n")]), "zzz");
    let r = prepare_twice(&c, &p);
    assert_eq!(r["certified"], json!(false));
    assert_eq!(r["fallbackReason"], json!("notTheParent"));
}

#[test]
fn an_identical_restore_retry_gets_the_original_reply_with_no_append() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let first = human_save(&c.writer, d, "first ünïcode 文字\n");
    let head = human_save(&c.writer, d, "second\n");
    let payload = json!({
        "docKey": KEY,
        "parent": head,
        "preimage": "second\n",
        "source": { "from": "revision", "revision": first },
        "requestId": request_id(),
    })
    .to_string();
    let a = c.restore_prepare(&payload).expect("restore");
    let len = c.writer.journal_len();
    let b = c.restore_prepare(&payload).expect("retry");
    assert_eq!(a, b);
    assert_eq!(a.text, "first ünïcode 文字\n");
    assert_eq!(c.writer.journal_len(), len, "nothing appended");
}

#[test]
fn a_different_payload_under_the_same_request_id_is_refused_unchanged() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let req = request_id();
    c.prepare(&body(Some(head), "a\nb\n", Some(&req)).to_string())
        .expect("prepare");
    let before = observable(&c.writer, dir.path());
    let err = c
        .prepare(&body(Some(head), "a\nc\n", Some(&req)).to_string())
        .expect_err("another digest");
    assert_eq!(journal_code(&err), "INVALID_REQUEST");
    assert_eq!(observable(&c.writer, dir.path()), before);
}

#[test]
fn a_retry_after_the_transaction_ended_is_refused() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let raw = body(Some(head), "a\n", Some(&request_id())).to_string();
    let p = c.prepare(&raw).expect("prepare");
    c.abort(&p.txn.to_string(), "edited").expect("abort");
    let len = c.writer.journal_len();
    let err = c.prepare(&raw).expect_err("terminal");
    assert_eq!(journal_code(&err), "STALE_REQUEST");
    let detail = err.detail().expect("detail");
    assert_eq!(detail["uncertain"], json!(false));
    assert_eq!(detail["request"]["state"], json!("terminal"));
    assert_eq!(detail["request"]["status"], json!("aborted"));
    assert_eq!(c.writer.journal_len(), len);
}

#[test]
fn a_consumed_capture_under_a_new_request_id_is_refused() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let mut p = body(Some(head), "a\n", Some(&request_id()));
    p["capture"] = capture("session-1", 4);
    let t = c.prepare(&p.to_string()).expect("prepare");
    c.abort(&t.txn.to_string(), "edited").expect("abort");

    p["requestId"] = json!(request_id());
    let len = c.writer.journal_len();
    let err = c.prepare(&p.to_string()).expect_err("consumed capture");
    assert_eq!(journal_code(&err), "INVALID_REQUEST");
    assert_eq!(c.writer.journal_len(), len);

    p["requestId"] = json!(request_id());
    p["capture"] = capture("session-1", 5);
    c.prepare(&p.to_string()).expect("the next seq prepares");
}

#[test]
fn a_refused_prepare_does_not_consume_its_capture() {
    let dir = tmp();
    let (c, faults) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let mut p = body(Some(head), "a\nb\n", Some(&request_id()));
    p["capture"] = capture("session-2", 1);
    faults.fail_next_appends(1);
    assert_eq!(outcome(&c.prepare(&p.to_string())), "refused");
    c.prepare(&p.to_string())
        .expect("the same capture prepares");
}

/// R44's order: the receipt lookup runs before the capture check, so a
/// retry that resends its consumed capture is answered, not refused.
#[test]
fn a_captured_retry_takes_the_duplicate_path_with_nothing_appended() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let head = human_save(&c.writer, doc(&c), "a\n");
    let mut p = body(Some(head), "a\nb\n", Some(&request_id()));
    p["capture"] = capture("s", 3);
    prepare_twice(&c, &p);
}

/// A write from another window between the original and its retry does
/// not change the retry's answer.
#[test]
fn a_captured_retry_after_another_window_writes_gets_the_same_reply() {
    let dir = tmp();
    let (c, _) = controller(dir.path());
    let d = doc(&c);
    let head = human_save(&c.writer, d, "a\n");
    let mut p = body(Some(head), "a\nb\n", Some(&request_id()));
    p["capture"] = capture("s", 3);
    let raw = p.to_string();
    let first = c.prepare(&raw).expect("first prepare");

    let before = c.writer.journal_len();
    c.writer
        .observe_for_window(
            ObserveRequest {
                doc: d,
                actor: human(),
                initiator: human(),
                postimage: "a\nother window\n".into(),
                observed_parent: ObservedRef::Revision { revision: head },
                provenance: None,
            },
            Some("doc-2/t1@b"),
        )
        .expect("the other window's save");
    let len = c.writer.journal_len();
    assert!(len > before, "the other window's save was journaled");
    let second = c.prepare(&raw).expect("the identical retry");
    assert_eq!(second, first, "the stored reply");
    assert_eq!(c.writer.journal_len(), len, "nothing appended");
}
