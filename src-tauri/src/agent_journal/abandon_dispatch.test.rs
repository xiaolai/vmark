// WI-AL2.2g — abandon and the identity checks through real command dispatch: contradictory requestId, incarnation, digest and webviewGeneration keys beside the payload change nothing in the unknown, in-flight, queued and durable-receipt branches; an abandon whose payload differs by one preimage byte is a conflict; and a changed identity byte follows the refusal precedence for both prepare and abandon
//! The 2.2f core versions of these cases stay in `request_abandon` and
//! `request_order`; these run the same cases through the generated
//! handler, so only what the command reads from its arguments counts.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::admission::page_table_tests::ident;
use crate::agent_journal::commands::commands_dispatch::{p, p_on, ready, txn_of, App, Page};
use crate::agent_journal::projection::TxnStatus;
use crate::ipc_caller::invoke_from;

fn with(p: &str, key: &str, value: Value) -> String {
    let mut v: Value = serde_json::from_str(p).expect("payload");
    v[key] = value;
    v.to_string()
}

fn prepare(page: &Page, p: &str) -> Result<Value, Value> {
    invoke_from(&page.win, "agent_journal_prepare", json!({ "payload": p }))
}

/// Abandon `p` from `page`'s window, with contradictory outer keys.
fn abandon_noisy(page: &Page, p: &str) -> Result<Value, Value> {
    let args = json!({
        "payload": p,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "incarnation": ident(9),
        "digest": "0".repeat(64),
        "webviewGeneration": "424242",
        "pageIdentity": ident(8),
    });
    invoke_from(&page.win, "agent_journal_abandon", args)
}

fn state(err: &Value) -> &str {
    err["detail"]["request"]["state"].as_str().unwrap_or("")
}

/// Start `p`'s prepare through dispatch on another thread and hold it
/// after its in-flight entry is taken, before admission.
fn hold(
    a: &App,
    page: &Page,
    p: &str,
) -> (
    std::thread::JoinHandle<Result<Value, Value>>,
    mpsc::Sender<()>,
) {
    let (at, reached) = mpsc::channel();
    let (go, wait) = mpsc::channel::<()>();
    a.faults.before_nth_lock(
        2,
        Some(Box::new(move || {
            at.send(()).unwrap();
            wait.recv().unwrap();
        })),
    );
    let (win, p) = (page.win.clone(), p.to_owned());
    let h = std::thread::spawn(move || {
        invoke_from(&win, "agent_journal_prepare", json!({ "payload": p }))
    });
    reached
        .recv_timeout(Duration::from_secs(5))
        .expect("the original paused before admission");
    (h, go)
}

#[test]
fn abandon_dispatch_ignores_contradictory_outer_fields() {
    let a = ready();
    let page = a.page("doc-a", 1);

    // Unknown id: fenced, so a later attempt is abandoned.
    let unknown = p(&page, "text");
    assert_eq!(
        abandon_noisy(&page, &unknown).expect("unknown"),
        json!({ "state": "fenced" })
    );
    assert_eq!(state(&prepare(&page, &unknown).unwrap_err()), "abandoned");

    // In flight: the entry is taken and the original answers abandoned.
    let running = p(&page, "text");
    let (h, go) = hold(&a, &page, &running);
    assert_eq!(
        abandon_noisy(&page, &running).expect("in flight"),
        json!({ "state": "fenced" })
    );
    go.send(()).unwrap();
    assert_eq!(state(&h.join().unwrap().unwrap_err()), "abandoned");

    // Durable receipt: the transaction is aborted.
    let receipted = p(&page, "text");
    let reply = prepare(&page, &receipted).expect("prepare");
    let txn = txn_of(&reply);
    // The unsaved "text" was admitted as a baseline: the head now.
    let head = serde_json::from_value(reply["reply"]["baseline"].clone()).expect("baseline");
    assert_eq!(
        abandon_noisy(&page, &receipted).expect("receipted"),
        json!({ "state": "aborted" })
    );
    assert_eq!(a.status(txn), Some(TxnStatus::Aborted));

    // Queued: the abort sits behind a failed append.
    let queued = p_on(&page, head, "text");
    let txn = txn_of(&prepare(&page, &queued).expect("prepare"));
    a.faults.fail_next_appends(1);
    assert_eq!(
        abandon_noisy(&page, &queued).expect("queued"),
        json!({ "state": "abortQueued" })
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while a.status(txn) != Some(TxnStatus::Aborted) {
        assert!(
            std::time::Instant::now() < deadline,
            "the queued abort never drained"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn abandon_with_one_byte_different_payload_is_conflict() {
    let a = ready();
    let page = a.page("doc-a", 1);
    let p0 = p(&page, "text");
    let txn = txn_of(&prepare(&page, &p0).expect("prepare"));
    let e = abandon_noisy(&page, &with(&p0, "preimage", json!("texT"))).expect_err("receipted");
    assert_eq!(state(&e), "conflict", "{e}");
    assert_eq!(e["detail"]["journalCode"], "INVALID_REQUEST");
    assert_eq!(a.status(txn), Some(TxnStatus::Prepared), "untouched");
}

#[test]
fn identity_byte_changes_follow_refusal_precedence() {
    let a = ready();
    let page = a.page("doc-a", 1);
    let b = a.register(page.win.clone(), 2);
    let p0 = p(&page, "text");
    let txn = txn_of(&prepare(&page, &p0).expect("prepare"));
    let len = a.journal_len();
    let cases = [
        ("incarnation", json!(ident(7)), "staleIncarnation"),
        ("webviewGeneration", json!("999"), "staleGeneration"),
        ("webviewGeneration", json!(b.generation), "conflict"),
        ("pageIdentity", json!(b.identity), "conflict"),
        ("preimage", json!("texT"), "conflict"),
    ];
    for (key, value, want) in cases {
        let q = with(&p0, key, value);
        let e = prepare(&page, &q).expect_err("one byte changed");
        assert_eq!(state(&e), want, "prepare with {key} changed: {e}");
        let e = invoke_from(&page.win, "agent_journal_abandon", json!({ "payload": q }))
            .expect_err("one byte changed");
        assert_eq!(state(&e), want, "abandon with {key} changed: {e}");
    }
    assert_eq!(
        a.status(txn),
        Some(TxnStatus::Prepared),
        "the original untouched"
    );
    assert_eq!(a.journal_len(), len, "nothing recorded");
}
