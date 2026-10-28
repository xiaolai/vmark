// WI-AL2.0s — a journal a newer build wrote: startup leaves both files byte-identical, the status says off (failed, read-only, JOURNAL_FUTURE_FORMAT), and every journal command, history and checkpoints included, refuses through real IPC dispatch with a typed JOURNAL_FUTURE_FORMAT
//! Future-format refusal through command dispatch (R54).
//!
//! Each command is invoked the way a webview invokes it: through the mock
//! runtime's IPC layer and the generated handler, so argument decoding and
//! the error's wire shape are what the frontend receives. Gated off Windows,
//! where `tauri::test` does not exist.
//!
//! Edge cases: commands whose payload would be invalid (the refusal must win
//! before any parse); history and checkpoint reads (not only writes); the
//! git export, which needs the journal directory rather than the controller;
//! both file hashes checked after every command has run.

use std::path::Path;

use serde_json::{json, Value};
use sha2_v011::{Digest, Sha256};
use tauri::test::MockRuntime;
use tauri::Manager;

use crate::agent_journal::blob_store::BLOB_PACK;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::journal_file::JOURNAL_FILE;
use crate::agent_journal::record::MAX_SUPPORTED_SCHEMA;
use crate::agent_journal::service::{start, AgentJournalState, Phase, JOURNAL_DIR};
use crate::agent_journal::test_support::*;
use crate::agent_journal::{commands, commands_history, git_export};
use crate::ipc_caller::{invoke_from, window};

/// `v` with a well-formed `callId`, so the call reaches the journal.
fn call(mut v: Value) -> Value {
    v["callId"] = json!("0123456789abcdef0123456789abcdef");
    v
}

fn hashes(dir: &Path) -> Vec<Vec<u8>> {
    [JOURNAL_FILE, BLOB_PACK]
        .iter()
        .map(|f| Sha256::digest(std::fs::read(dir.join(f)).expect("file exists")).to_vec())
        .collect()
}

fn journal_app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_journal_status,
            commands::agent_journal_prepare,
            commands::agent_journal_commit,
            commands::agent_journal_abort,
            commands::agent_journal_capture,
            commands::agent_journal_arm_epoch,
            commands::agent_journal_close_epoch,
            commands::agent_journal_release_window,
            commands::agent_journal_abandon,
            commands::agent_journal_register_page,
            commands_history::agent_journal_restore_prepare,
            commands_history::agent_journal_history,
            commands_history::agent_journal_concurrent_pair,
            commands_history::agent_journal_uncommitted,
            commands_history::agent_journal_discard,
            commands_history::agent_journal_checkpoints,
            commands_history::agent_journal_checkpoints_forget,
            git_export::command::agent_journal_git_export,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A journal under `app_data` whose last record is one schema past this build.
fn write_future_journal(app_data: &Path) {
    let (w, _) = open(&app_data.join(JOURNAL_DIR));
    human_save(&w, DocId::new(), "a");
    let v = json!({"schemaVersion": MAX_SUPPORTED_SCHEMA + 1, "seq": "999", "txn": TxnId::new(), "at": 0, "record": {"kind": "fromTheFuture"}});
    w.debug_append_raw(&serde_json::to_vec(&v).unwrap())
        .unwrap();
}

#[test]
fn future_format_every_journal_command_refuses_through_dispatch_and_both_files_keep_unchanged_bytes(
) {
    let data = tmp();
    write_future_journal(data.path());
    let dir = data.path().join(JOURNAL_DIR);
    let before = hashes(&dir);

    let app = journal_app();
    let state = app.state::<AgentJournalState>();
    state.finish(start(data.path()));
    assert_eq!(hashes(&dir), before, "startup changed nothing");
    assert!(state.writer().is_none(), "no history is exposed");

    let caller = window(&app, "main");
    let status = invoke_from(&caller, "agent_journal_status", call(json!({}))).expect("status");
    let status = &status["reply"];
    assert_eq!(status["phase"], json!(Phase::Failed));
    assert_eq!(status["readOnly"], true, "written by a newer build");
    let error = status["error"].as_str().unwrap_or_default();
    assert!(error.starts_with("JOURNAL_FUTURE_FORMAT"), "{status}");

    let txn = TxnId::new().to_string();
    let pair = |mut v: Value| {
        v["pageIdentity"] = json!("0".repeat(32));
        v["webviewGeneration"] = json!("1");
        v
    };
    let calls: [(&str, Value); 17] = [
        ("agent_journal_history", call(json!({"payload": "{}"}))),
        (
            "agent_journal_concurrent_pair",
            call(json!({"payload": "{}"})),
        ),
        ("agent_journal_checkpoints", call(json!({}))),
        (
            "agent_journal_checkpoints_forget",
            call(json!({"payload": "{}"})),
        ),
        ("agent_journal_uncommitted", call(json!({"payload": "{}"}))),
        ("agent_journal_discard", call(json!({"payload": "{}"}))),
        ("agent_journal_restore_prepare", json!({"payload": "{}"})),
        ("agent_journal_prepare", json!({"payload": "not json"})),
        (
            "agent_journal_commit",
            pair(json!({"txn": txn, "payload": "{}"})),
        ),
        (
            "agent_journal_abort",
            pair(json!({"txn": txn, "reason": "x"})),
        ),
        ("agent_journal_abandon", json!({"payload": "not json"})),
        (
            "agent_journal_register_page",
            json!({"pageIdentity": "0".repeat(32)}),
        ),
        ("agent_journal_capture", call(json!({"payload": "{}"}))),
        ("agent_journal_arm_epoch", call(json!({"payload": "{}"}))),
        ("agent_journal_close_epoch", call(json!({"payload": "{}"}))),
        (
            "agent_journal_release_window",
            call(json!({"window": "doc-1"})),
        ),
        ("agent_journal_git_export", call(json!({"payload": "{}"}))),
    ];
    for (command, args) in calls {
        let err = invoke_from(&caller, command, args).expect_err(&format!("{command} must refuse"));
        assert_eq!(
            err["detail"]["journalCode"], "JOURNAL_FUTURE_FORMAT",
            "{command}: {err}"
        );
    }
    assert_eq!(hashes(&dir), before, "no command changed a byte");
}
