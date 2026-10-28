// WI-AL2.2g — the live journal commands on the identity-carrying wire, through real IPC dispatch: each of prepare, commit, abort, restore prepare and abandon refuses a request missing any identity field and records nothing; register takes the label from the invoking window (never from its arguments), echoes the identity, and is JOURNAL_UNAVAILABLE before the journal is ready; prepare, restore, commit and abort replies travel in their bind envelopes
//! Each command is invoked the way a webview invokes it: through the mock
//! runtime's IPC layer and the generated handler, so argument decoding,
//! the caller's label and the reply's wire shape are what the frontend
//! sees. Gated off Windows, where `tauri::test` does not exist.

use std::sync::Arc;

use serde_json::{json, Value};
use sha2_v011::{Digest, Sha256};
use tauri::test::MockRuntime;
use tauri::{Manager, WebviewWindow};

use crate::agent_journal::admission::admission_support::{body, controller, doc, request_id, KEY};
use crate::agent_journal::admission::page_table_tests::ident;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{RevisionId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::service::{page_load_started, AgentJournalState, Started};
use crate::agent_journal::{commands, commands_history};
use crate::ipc_caller::{invoke_from, window as open_window};

/// A mock app serving the live journal commands, its journal ready over a
/// writer whose faults the test holds.
pub(crate) struct App {
    pub app: tauri::App<MockRuntime>,
    pub faults: Arc<Faults>,
    _dir: tempfile::TempDir,
}

pub(crate) fn mock_app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_journal_prepare,
            commands::agent_journal_commit,
            commands::agent_journal_abort,
            commands::agent_journal_abandon,
            commands::agent_journal_register_page,
            commands_history::agent_journal_restore_prepare,
            commands_history::agent_journal_revert_prepare,
            commands_history::agent_journal_review_decide,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

pub(crate) fn ready() -> App {
    ready_with(mock_app())
}

/// `app` (which manages an `AgentJournalState`) with its journal ready.
pub(crate) fn ready_with(app: tauri::App<MockRuntime>) -> App {
    let dir = tempfile::tempdir().expect("tempdir");
    let (c, faults) = controller(dir.path());
    app.state::<AgentJournalState>().finish(Ok(Started {
        writer: c.writer.clone(),
        journal_dir: dir.path().to_path_buf(),
        open: Default::default(),
        legacy: Ok(Default::default()),
        retirement: crate::agent_journal::service::LegacyRetirement::Absent,
        gc: Default::default(),
    }));
    App {
        app,
        faults,
        _dir: dir,
    }
}

/// A page registered through dispatch: its window and its pair.
pub(crate) struct Page {
    pub win: WebviewWindow<MockRuntime>,
    pub identity: String,
    pub generation: String,
    pub incarnation: String,
}

impl App {
    /// Open window `label` (a delivered page load) and register page `n`
    /// from it through dispatch.
    pub(crate) fn page(&self, label: &str, n: u32) -> Page {
        let win = open_window(&self.app, label);
        page_load_started(self.app.handle(), label);
        self.register(win, n)
    }

    pub(crate) fn register(&self, win: WebviewWindow<MockRuntime>, n: u32) -> Page {
        let out = invoke_from(
            &win,
            "agent_journal_register_page",
            json!({ "pageIdentity": ident(n) }),
        )
        .expect("register");
        let reply = &out["reply"];
        Page {
            identity: reply["pageIdentity"].as_str().unwrap().to_owned(),
            generation: reply["webviewGeneration"].as_str().unwrap().to_owned(),
            incarnation: reply["incarnation"].as_str().unwrap().to_owned(),
            win,
        }
    }

    pub(crate) fn writer(&self) -> Arc<crate::agent_journal::writer::Writer> {
        self.app
            .state::<AgentJournalState>()
            .writer()
            .expect("ready")
    }

    pub(crate) fn status(&self, txn: TxnId) -> Option<TxnStatus> {
        let w = self.writer();
        let g = w.lock();
        g.proj.txns.get(&txn).map(|t| t.status.clone())
    }

    pub(crate) fn journal_len(&self) -> u64 {
        self.writer().lock().journal.len()
    }
}

/// `body` frozen for `page`, with a fresh request id when it has none.
pub(crate) fn frame(page: &Page, mut body: Value) -> String {
    if body.get("requestId").is_none() {
        body["requestId"] = json!(request_id());
    }
    body["incarnation"] = json!(page.incarnation);
    body["webviewGeneration"] = json!(page.generation);
    body["pageIdentity"] = json!(page.identity);
    body.to_string()
}

pub(crate) fn p(page: &Page, preimage: &str) -> String {
    p_on(page, None, preimage)
}

/// `p` expecting `parent` as the document's head.
pub(crate) fn p_on(page: &Page, parent: Option<RevisionId>, preimage: &str) -> String {
    frame(page, body(parent, preimage, Some(&request_id())))
}

pub(crate) fn txn_of(reply: &Value) -> TxnId {
    serde_json::from_value(reply["reply"]["txn"].clone()).expect("txn")
}

/// `p` without `key`.
fn without(p: &str, key: &str) -> String {
    let mut v: Value = serde_json::from_str(p).unwrap();
    v.as_object_mut().unwrap().remove(key);
    v.to_string()
}

/// Lowercase hex SHA-256 of `s`'s bytes, computed independently of the
/// journal's own digest.
fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

const IDENTITY: [&str; 3] = ["incarnation", "webviewGeneration", "pageIdentity"];

#[test]
fn each_live_command_refuses_a_request_missing_an_identity_field() {
    let a = ready();
    let page = a.page("doc-a", 1);
    let prepared = p(&page, "text");
    let ok = invoke_from(
        &page.win,
        "agent_journal_prepare",
        json!({ "payload": prepared }),
    )
    .expect("the whole payload prepares");
    let txn = txn_of(&ok).0.to_string();
    let before = a.journal_len();

    // Refused while decoding the frame, so the source need not exist.
    let restore = frame(
        &page,
        json!({ "docKey": KEY, "parent": null, "preimage": "text",
                "source": { "from": "revision", "revision": RevisionId::new() } }),
    );
    for field in IDENTITY {
        for (command, payload) in [
            ("agent_journal_prepare", p(&page, "other")),
            ("agent_journal_restore_prepare", restore.clone()),
            ("agent_journal_abandon", prepared.clone()),
        ] {
            let err = invoke_from(
                &page.win,
                command,
                json!({ "payload": without(&payload, field) }),
            )
            .expect_err(&format!("{command} without {field}"));
            assert_eq!(
                err["detail"]["journalCode"], "INVALID_REQUEST",
                "{command}/{field}: {err}"
            );
            // The frame decoder's own refusal, not a digest or pair check
            // that a defaulted field would reach instead.
            let message = err["message"].as_str().unwrap_or_default();
            assert!(
                message.contains(&format!("a framed payload names {field} as a string")),
                "{command}/{field}: {err}"
            );
        }
    }
    assert_eq!(
        a.journal_len(),
        before,
        "no payload missing a field recorded anything"
    );

    let pair = json!({ "pageIdentity": page.identity, "webviewGeneration": page.generation });
    for missing in ["pageIdentity", "webviewGeneration"] {
        let mut commit =
            json!({ "txn": txn, "payload": json!({"postimage": "text!"}).to_string() });
        let mut abort = json!({ "txn": txn, "reason": "edited" });
        for args in [&mut commit, &mut abort] {
            for (k, v) in pair.as_object().unwrap() {
                if k != missing {
                    args[k] = v.clone();
                }
            }
        }
        for (command, args) in [
            ("agent_journal_commit", commit),
            ("agent_journal_abort", abort),
        ] {
            // Refused by the IPC's argument decoding, before the journal sees a
            // request: a defaulted field would reach the pair check instead.
            let err = invoke_from(&page.win, command, args)
                .expect_err(&format!("{command} without {missing}"));
            let text = err.as_str().unwrap_or_default();
            assert!(
                text.contains(&format!("missing required key {missing}")),
                "{command}/{missing}: {err}"
            );
        }
    }
    assert_eq!(
        a.status(TxnId(txn.parse().unwrap())),
        Some(TxnStatus::Prepared)
    );
    assert_eq!(
        a.journal_len(),
        before,
        "a refused commit or abort records nothing"
    );

    let err = invoke_from(&page.win, "agent_journal_register_page", json!({}))
        .expect_err("register without pageIdentity");
    assert!(
        err.as_str()
            .unwrap_or_default()
            .contains("missing required key pageIdentity"),
        "register: {err}"
    );
}

#[test]
fn register_takes_the_label_from_the_invoking_window_and_echoes_the_identity() {
    let a = ready();
    open_window(&a.app, "main");
    page_load_started(a.app.handle(), "main");
    let win = open_window(&a.app, "doc-1");
    page_load_started(a.app.handle(), "doc-1");
    let out = invoke_from(
        &win,
        "agent_journal_register_page",
        json!({ "pageIdentity": ident(4), "label": "main", "window": "main" }),
    )
    .expect("register");
    assert_eq!(out["bind"], json!({ "pageIdentity": ident(4) }));
    assert_eq!(out["reply"]["pageIdentity"], json!(ident(4)));
    assert_eq!(
        out["reply"]["incarnation"],
        json!(a.writer().incarnation().to_string())
    );
    assert!(
        out["reply"]["webviewGeneration"].is_string(),
        "a decimal string: {out}"
    );
    let pages = a.app.state::<AgentJournalState>().pages().clone();
    assert_eq!(
        (pages.registrations("doc-1"), pages.registrations("main")),
        (1, 0)
    );

    let old = (ident(4), out["reply"]["webviewGeneration"].clone());
    let again = invoke_from(
        &win,
        "agent_journal_register_page",
        json!({ "pageIdentity": ident(5),
                "replaces": { "pageIdentity": old.0, "webviewGeneration": old.1 } }),
    )
    .expect("register with replaces");
    assert_eq!(again["reply"]["pageIdentity"], json!(ident(5)));
    assert_eq!(pages.registrations("doc-1"), 1, "the old pair is replaced");
}

#[test]
fn register_before_the_journal_is_ready_is_unavailable_and_mints_nothing() {
    let app = mock_app();
    let win = open_window(&app, "doc-1");
    page_load_started(app.handle(), "doc-1");
    let err = invoke_from(
        &win,
        "agent_journal_register_page",
        json!({ "pageIdentity": ident(1) }),
    )
    .expect_err("not ready");
    assert_eq!(err["detail"]["journalCode"], "JOURNAL_UNAVAILABLE", "{err}");
    let pages = app.state::<AgentJournalState>().pages().clone();
    assert_eq!(pages.registrations("doc-1"), 0);
}

#[test]
fn prepare_restore_commit_and_abort_replies_travel_in_their_envelopes() {
    let a = ready();
    let page = a.page("doc-a", 1);
    let payload = p(&page, "text");
    let out = invoke_from(
        &page.win,
        "agent_journal_prepare",
        json!({ "payload": payload }),
    )
    .expect("prepare");
    let digest = sha256_hex(&payload);
    let id: Value = serde_json::from_str::<Value>(&payload).unwrap()["requestId"].clone();
    assert_eq!(out["bind"], json!({ "requestId": id, "digest": digest }));
    let txn = txn_of(&out).0.to_string();
    let pair = |args: Value| {
        let mut args = args;
        args["pageIdentity"] = json!(page.identity);
        args["webviewGeneration"] = json!(page.generation);
        args
    };
    let committed = invoke_from(
        &page.win,
        "agent_journal_commit",
        pair(json!({ "txn": txn, "payload": json!({"postimage": "text!"}).to_string() })),
    )
    .expect("commit");
    let want =
        json!({ "txn": txn, "pageIdentity": page.identity, "webviewGeneration": page.generation });
    assert_eq!(committed["bind"], want);
    assert_eq!(committed["reply"]["durable"], true, "{committed}");

    let c = a.app.state::<AgentJournalState>().controller().unwrap();
    let head = c.writer.lock().proj.docs[&doc(&c)].head.expect("head");
    let restore = frame(
        &page,
        json!({ "docKey": KEY, "parent": head, "preimage": "text!",
                "source": { "from": "revision", "revision": head } }),
    );
    let restored = invoke_from(
        &page.win,
        "agent_journal_restore_prepare",
        json!({ "payload": restore }),
    )
    .expect("restore prepare");
    let rid: Value = serde_json::from_str::<Value>(&restore).unwrap()["requestId"].clone();
    assert_eq!(
        restored["bind"],
        json!({ "requestId": rid, "digest": sha256_hex(&restore) })
    );
    let rtxn = txn_of(&restored).0.to_string();
    let aborted = invoke_from(
        &page.win,
        "agent_journal_abort",
        pair(json!({ "txn": rtxn, "reason": "edited" })),
    )
    .expect("abort");
    let want =
        json!({ "txn": rtxn, "pageIdentity": page.identity, "webviewGeneration": page.generation });
    assert_eq!(aborted["bind"], want);
    assert_eq!(aborted["reply"], json!({ "durable": true }));
}
