// WI-AL1.6 — the status query never blocks an async worker on the writer lock: on a one-worker runtime, a status asked while another task holds the lock answers once that task lets go
//! On a current-thread runtime the query and the task holding the lock
//! share the one worker: a query that waited for the lock on it would
//! never let the holder run. Gated off Windows, where `tauri::test` does
//! not exist.

use std::sync::mpsc;
use std::time::Duration;

use tauri::Manager;

use crate::agent_journal::admission::admission_support::controller;
use crate::agent_journal::commands;
use crate::agent_journal::service::{AgentJournalState, LegacyRetirement, Started};

const CALL: &str = "0123456789abcdef0123456789abcdef";

#[test]
fn a_status_asked_while_the_writer_lock_is_held_does_not_block_the_worker() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (c, _faults) = controller(dir.path());
    let app = tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.state::<AgentJournalState>().finish(Ok(Started {
        writer: c.writer.clone(),
        journal_dir: dir.path().to_path_buf(),
        open: Default::default(),
        legacy: Ok(Default::default()),
        retirement: LegacyRetirement::Absent,
        gc: Default::default(),
    }));
    let (handle, writer) = (app.handle().clone(), c.writer.clone());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let out = rt.block_on(async {
            let held = writer.lock();
            let status = commands::agent_journal_status(handle, CALL.into());
            let release = async move {
                tokio::task::yield_now().await;
                drop(held);
            };
            tokio::join!(status, release).0
        });
        let _ = tx.send(out.is_ok());
    });
    let answered = rx.recv_timeout(Duration::from_secs(5));
    assert_eq!(answered, Ok(true), "the status query blocked its worker");
}
