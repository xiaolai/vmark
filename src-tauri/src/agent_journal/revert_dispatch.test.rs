// WI-AL2.2d — agent_journal_revert_prepare through real IPC dispatch: an applied revert replies kind prepared in its request bind envelope and commits through the owning page; a payload missing an identity field is refused by the frame decoder with nothing recorded
//! The revert command the way a webview invokes it (mock runtime IPC).

use serde_json::{json, Value};
use tauri::Manager;

use crate::agent_journal::admission::admission_support::{doc, KEY};
use crate::agent_journal::commands::commands_dispatch::{frame, ready};
use crate::agent_journal::service::AgentJournalState;
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::{head_text, observed_on};
use crate::ipc_caller::invoke_from;

const IDENTITY: [&str; 3] = ["incarnation", "webviewGeneration", "pageIdentity"];

#[test]
fn a_revert_prepare_travels_in_its_envelope_and_commits() {
    let a = ready();
    let page = a.page("doc-a", 1);
    let c = a.app.state::<AgentJournalState>().controller().unwrap();
    let (w, d) = (&c.writer, doc(&c));
    let (h, _) = two_hunks(w, d);
    let revert = frame(
        &page,
        json!({ "docKey": KEY, "parent": w.head(d), "observedParent": observed_on(w.head(d)),
                "preimage": "xx", "hunkId": h,
                "expectedReviewGen": state(w, d, &h).1.to_string() }),
    );

    let before = a.journal_len();
    for field in IDENTITY {
        let mut v: Value = serde_json::from_str(&revert).unwrap();
        v.as_object_mut().unwrap().remove(field);
        let err = invoke_from(
            &page.win,
            "agent_journal_revert_prepare",
            json!({ "payload": v.to_string() }),
        )
        .expect_err(field);
        assert_eq!(
            err["detail"]["journalCode"], "INVALID_REQUEST",
            "{field}: {err}"
        );
    }
    assert_eq!(
        a.journal_len(),
        before,
        "no payload missing a field recorded anything"
    );

    let out = invoke_from(
        &page.win,
        "agent_journal_revert_prepare",
        json!({ "payload": revert }),
    )
    .expect("revert prepare");
    let id = serde_json::from_str::<Value>(&revert).unwrap()["requestId"].clone();
    assert_eq!(out["bind"]["requestId"], id, "{out}");
    assert_eq!(out["reply"]["kind"], "prepared", "{out}");
    let txn = out["reply"]["response"]["txn"]
        .as_str()
        .expect("txn")
        .to_owned();
    let committed = invoke_from(
        &page.win,
        "agent_journal_commit",
        json!({ "txn": txn, "payload": json!({ "postimage": "yx" }).to_string(),
                "pageIdentity": page.identity, "webviewGeneration": page.generation }),
    )
    .expect("commit");
    assert_eq!(committed["reply"]["durable"], true, "{committed}");
    assert_eq!(head_text(w, d), "yx");
}
