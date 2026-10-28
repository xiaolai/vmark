// WI-AL2.2h — the app's page-load and destroy entries, over the managed journal state of a mock app (the hook itself is not fired: the mock runtime has no page loads, so the builder registration is native evidence): a page load revokes the window's registrations and the production cleanup worker ends the prepared transaction they owned, uncommitted; a destroyed window leaves the page table and ends its transaction the same way; both act on the table before the journal is ready, and do nothing else then; and the page-load entry returns at once while the writer lock is held
//! Driven through `page_load_started` and `release_window_label`, the
//! functions the hook and the `Destroyed` handler call.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::test::MockRuntime;
use tauri::Manager;

use crate::agent_journal::admission::admission_support::{body, request_id};
use crate::agent_journal::admission::lifecycle_support::wait_until;
use crate::agent_journal::admission::page_table_tests::ident;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::service::{
    page_load_started, release_window_label, start, AgentJournalState,
};

fn mock_app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A ready journal with page 1 registered in `label` and a prepared
/// transaction it owns.
fn prepared(app: &tauri::App<MockRuntime>, dir: &std::path::Path, label: &str) -> TxnId {
    let state = app.state::<AgentJournalState>();
    state.finish(start(dir));
    let writer = state.writer().expect("ready");
    page_load_started(app.handle(), label);
    let reg = state
        .pages()
        .register(Some(&writer), label, &ident(1), None)
        .expect("register");
    let mut p = body(None, "text", Some(&request_id()));
    p["incarnation"] = json!(writer.incarnation().to_string());
    p["webviewGeneration"] = json!(reg.webview_generation.to_string());
    p["pageIdentity"] = json!(reg.page_identity.to_string());
    let c = state.controller().expect("controller");
    let out = c
        .prepare_framed(state.pages(), label, &p.to_string())
        .expect("prepare");
    let reply = serde_json::to_value(out).expect("reply");
    serde_json::from_value(reply["reply"]["txn"].clone()).expect("txn")
}

fn status(app: &tauri::App<MockRuntime>, txn: TxnId) -> Option<TxnStatus> {
    let w = app.state::<AgentJournalState>().writer().expect("ready");
    let g = w.lock();
    g.proj.txns.get(&txn).map(|t| t.status.clone())
}

#[test]
fn a_page_load_revokes_the_window_and_the_worker_ends_its_transaction() {
    let app = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let txn = prepared(&app, dir.path(), "doc-1");
    assert_eq!(status(&app, txn), Some(TxnStatus::Prepared));

    page_load_started(app.handle(), "doc-1");
    let pages = app.state::<AgentJournalState>().pages().clone();
    assert_eq!((pages.labels(), pages.registrations("doc-1")), (1, 0));
    wait_until("the sweep to end the transaction", || {
        status(&app, txn) == Some(TxnStatus::Uncommitted)
    });
    let w = app.state::<AgentJournalState>().writer().unwrap();
    assert!(
        w.lock().reservations.is_empty(),
        "the reservation is released"
    );
}

#[test]
fn a_destroyed_window_leaves_the_table_and_its_transaction_ends() {
    let app = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let txn = prepared(&app, dir.path(), "doc-1");
    page_load_started(app.handle(), "doc-2");

    release_window_label(app.handle(), "doc-1");
    let pages = app.state::<AgentJournalState>().pages().clone();
    assert_eq!(pages.labels(), 1, "only doc-2 is left");
    wait_until("the sweep to end the transaction", || {
        status(&app, txn) == Some(TxnStatus::Uncommitted)
    });
}

#[test]
fn page_events_before_the_journal_is_ready_change_only_the_table() {
    let app = mock_app();
    let state = app.state::<AgentJournalState>();
    page_load_started(app.handle(), "doc-1");
    page_load_started(app.handle(), "doc-2");
    assert_eq!(
        state.pages().labels(),
        2,
        "the hook opens labels from launch"
    );
    release_window_label(app.handle(), "doc-1");
    assert_eq!(state.pages().labels(), 1, "destroy removes before ready");
    wait_until("the worker to go idle", || {
        state.cleanup.state() == (false, false)
    });
    assert_eq!(state.status().cleanup_worker_failures, 0);
    assert!(state.writer().is_none());
}

#[test]
fn the_page_load_entry_returns_while_the_writer_lock_is_held() {
    let app = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let txn = prepared(&app, dir.path(), "doc-1");
    let w = app.state::<AgentJournalState>().writer().expect("ready");
    let g = w.lock();
    let handle = app.handle().clone();
    let (done, finished) = mpsc::channel();
    let entry = thread::spawn(move || {
        page_load_started(&handle, "doc-1");
        done.send(()).unwrap();
    });
    let returned = finished.recv_timeout(Duration::from_secs(2));
    drop(g);
    entry.join().unwrap();
    returned.expect("the page-load entry waited on the writer lock");
    wait_until("the sweep to end the transaction", || {
        status(&app, txn) == Some(TxnStatus::Uncommitted)
    });
}
