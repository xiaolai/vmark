// WI-AL2.3 — agent_journal_review_decide through real IPC dispatch: a keep and then an un-keep each travel as {bind: {callId}, reply: {generation}} and move the hunk, its reviewGen up by one; conflicted and revertFoundBase come only from revert admission and are refused INVALID_REQUEST; a stale reviewGen, a stale expectedHead or a document the journal never saw is STALE_REVIEW; a reserved document is JOURNAL_BUSY; a payload with a missing, extra or numeric field, or without a callId, is refused — and no refusal appends anything
//! The review panel's decision command the way a webview invokes it (mock
//! runtime IPC). The decision itself is `Writer::decide`, tested in depth
//! by the review-state tests; here the wire: its argument decoding, the
//! actions it admits, its refusal codes and its reply envelope.

use serde_json::{json, Value};
use tauri::Manager;

use crate::agent_journal::admission::admission_support::{doc, KEY};
use crate::agent_journal::commands::commands_dispatch::ready;
use crate::agent_journal::ids::HunkId;
use crate::agent_journal::review::{HunkState, ReviewOp};
use crate::agent_journal::service::AgentJournalState;
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::prepare_req;
use crate::ipc_caller::{invoke_from, window};

const CALL: &str = "0123456789abcdef0123456789abcdef";
const COMMAND: &str = "agent_journal_review_decide";

fn decide_args(head: Value, action: &str, hunk: &HunkId, rg: u64) -> Value {
    json!({
        "payload": json!({
            "docKey": KEY, "expectedHead": head, "action": action,
            "items": [{ "hunkId": hunk, "expectedReviewGen": rg.to_string() }],
        }).to_string(),
        "callId": CALL,
    })
}

fn code(err: &Value) -> &str {
    err["detail"]["journalCode"].as_str().unwrap_or_default()
}

#[test]
fn a_keep_then_an_unkeep_travel_in_their_envelope_and_move_the_hunk() {
    let a = ready();
    let win = window(&a.app, "main");
    let c = a.app.state::<AgentJournalState>().controller().unwrap();
    let (w, d) = (&c.writer, doc(&c));
    let (h, _) = two_hunks(w, d);
    let rg = state(w, d, &h).1;

    let out =
        invoke_from(&win, COMMAND, decide_args(json!(w.head(d)), "keep", &h, rg)).expect("keep");
    assert_eq!(out["bind"], json!({ "callId": CALL }), "{out}");
    let generation = w.lock().proj.generation;
    assert_eq!(
        out["reply"],
        json!({ "generation": generation.to_string() })
    );
    assert_eq!(state(w, d, &h), (HunkState::Kept, rg + 1));

    invoke_from(
        &win,
        COMMAND,
        decide_args(json!(w.head(d)), "unkeep", &h, rg + 1),
    )
    .expect("unkeep");
    assert_eq!(state(w, d, &h), (HunkState::Pending, rg + 2));
}

#[test]
fn every_refusal_is_coded_and_appends_nothing() {
    let a = ready();
    let win = window(&a.app, "main");
    let c = a.app.state::<AgentJournalState>().controller().unwrap();
    let (w, d) = (&c.writer, doc(&c));
    let (h, _) = two_hunks(w, d);
    let (head, rg) = (json!(w.head(d)), state(w, d, &h).1);
    // Journal bytes: any appended record grows them.
    let len = || w.lock().journal.len();
    let before = len();

    let mut cases: Vec<(&str, Value, &str)> = vec![
        (
            "conflicted",
            decide_args(head.clone(), "conflicted", &h, rg),
            "INVALID_REQUEST",
        ),
        (
            "revertFoundBase",
            decide_args(head.clone(), "revertFoundBase", &h, rg),
            "INVALID_REQUEST",
        ),
        (
            "a stale reviewGen",
            decide_args(head.clone(), "keep", &h, rg + 1),
            "STALE_REVIEW",
        ),
        (
            "a stale expectedHead",
            decide_args(json!(null), "keep", &h, rg),
            "STALE_REVIEW",
        ),
    ];
    let mut edit = |label: &'static str, f: &dyn Fn(&mut Value), want: &'static str| {
        let mut args = decide_args(head.clone(), "keep", &h, rg);
        let mut p: Value = serde_json::from_str(args["payload"].as_str().unwrap()).unwrap();
        f(&mut p);
        args["payload"] = json!(p.to_string());
        cases.push((label, args, want));
    };
    edit(
        "an unknown document",
        &|p| p["docKey"] = json!("path:/never.md"),
        "STALE_REVIEW",
    );
    edit(
        "no expectedHead",
        &|p| drop(p.as_object_mut().unwrap().remove("expectedHead")),
        "INVALID_REQUEST",
    );
    edit(
        "an extra field",
        &|p| p["tool"] = json!("revert"),
        "INVALID_REQUEST",
    );
    edit(
        "a numeric reviewGen",
        &|p| p["items"][0]["expectedReviewGen"] = json!(rg),
        "INVALID_REQUEST",
    );
    edit("no items", &|p| p["items"] = json!([]), "INVALID_REQUEST");
    edit(
        "an unknown action",
        &|p| p["action"] = json!("revert"),
        "INVALID_REQUEST",
    );

    for (label, args, want) in &cases {
        let err = invoke_from(&win, COMMAND, args.clone()).expect_err(label);
        assert_eq!(code(&err), *want, "{label}: {err}");
    }
    let mut no_call = decide_args(head.clone(), "keep", &h, rg);
    no_call.as_object_mut().unwrap().remove("callId");
    invoke_from(&win, COMMAND, no_call).expect_err("no callId");
    assert_eq!(len(), before, "no refusal appended a record");
    assert_eq!(
        state(w, d, &h),
        (HunkState::Pending, rg),
        "the hunk never moved"
    );
    assert!(
        a.app
            .state::<AgentJournalState>()
            .controller()
            .unwrap()
            .docs
            .find("path:/never.md")
            .unwrap()
            .is_none(),
        "a refused decision mints no document"
    );

    // A reserved document: an open agent transaction holds it.
    let p = w
        .prepare(prepare_req(d, w.head(d), "xx", ReviewOp::Review))
        .expect("reserve");
    let reserved = len();
    let err = invoke_from(&win, COMMAND, decide_args(head, "keep", &h, rg)).expect_err("busy");
    assert_eq!(code(&err), "JOURNAL_BUSY", "{err}");
    assert_eq!(len(), reserved, "the busy refusal appended nothing");
    w.abort(p.txn, "edited").expect("abort");
}
