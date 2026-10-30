// WI-AL2.2i — reply binding for the journal commands with no request key, through real IPC dispatch: each echoes the caller's fresh callId as `{bind: {callId}, reply}`, the body unchanged; a missing or malformed callId is refused before the command runs and changes nothing; and every agent_journal entry of all_commands! carries an R98 bind or a callId echo (every_journal_command_reply_is_bound) | AL2.2d: the revert prepare is request-bound like the restore prepare | AL2.3: the malformed-callId sweep covers every call-bound command, the review decide and the epoch close included | AL2.4: the concurrent pair read is call-bound and swept | AL3.2: the comment state changes, deletion and list are call-bound and swept; the comment creates and replies are request-bound | AL3.3: the agent comment list is call-bound and swept
//! Each command is invoked the way a webview invokes it: through the mock
//! runtime's IPC layer and the generated handler. Gated off Windows, where
//! `tauri::test` does not exist.
//!
//! Edge cases: a call id in uppercase, one byte short, or not hex; a call
//! id on a command whose work would fail anyway (the refusal is the call
//! id's, and nothing runs); a reply that is `null` (`find_document` of an
//! unknown key) or unit (`close_epoch`), still enveloped.

use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::Manager;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::admission_support::controller;
use crate::agent_journal::comment::{commands_agent, commands_user};
use crate::agent_journal::service::{AgentJournalState, Started};
use crate::agent_journal::{commands, commands_history, git_export};
use crate::ipc_caller::{invoke_from, window};

/// The commands bound by a call id, in the order they were converted.
const CALL_BOUND: [&str; 23] = [
    "agent_journal_capture",
    "agent_journal_arm_epoch",
    "agent_journal_close_epoch",
    "agent_journal_bind_document",
    "agent_journal_find_document",
    "agent_journal_release_window",
    "agent_journal_discard",
    "agent_journal_uncommitted",
    "agent_journal_checkpoints_forget",
    "agent_journal_checkpoints",
    "agent_journal_history",
    "agent_journal_status",
    "agent_journal_git_export",
    "agent_journal_head",
    "agent_journal_review_decide",
    "agent_journal_concurrent_pair",
    "comment_user_mark_addressed",
    "comment_user_resolve",
    "comment_user_reopen",
    "comment_user_delete",
    "comment_user_list",
    "comment_agent_mark_addressed",
    "comment_agent_list",
];

const CALL: &str = "0123456789abcdef0123456789abcdef";

struct Ready {
    app: tauri::App<MockRuntime>,
    _dir: tempfile::TempDir,
}

fn ready() -> Ready {
    let dir = tempfile::tempdir().expect("tempdir");
    let (c, _faults) = controller(dir.path());
    let app = tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_journal_status,
            commands::agent_journal_capture,
            commands::agent_journal_arm_epoch,
            commands::agent_journal_close_epoch,
            commands::agent_journal_release_window,
            commands::document::agent_journal_bind_document,
            commands::document::agent_journal_find_document,
            commands::document::agent_journal_head,
            commands_history::agent_journal_history,
            commands_history::agent_journal_uncommitted,
            commands_history::agent_journal_discard,
            commands_history::agent_journal_checkpoints,
            commands_history::agent_journal_checkpoints_forget,
            commands_history::agent_journal_review_decide,
            commands_history::agent_journal_concurrent_pair,
            git_export::command::agent_journal_git_export,
            commands_user::comment_user_mark_addressed,
            commands_user::comment_user_resolve,
            commands_user::comment_user_reopen,
            commands_user::comment_user_delete,
            commands_user::comment_user_list,
            commands_agent::comment_agent_mark_addressed,
            commands_agent::comment_agent_list,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.state::<AgentJournalState>().finish(Ok(Started {
        writer: c.writer.clone(),
        journal_dir: dir.path().to_path_buf(),
        open: Default::default(),
        legacy: Ok(Default::default()),
        retirement: crate::agent_journal::service::LegacyRetirement::Absent,
        gc: Default::default(),
    }));
    Ready { app, _dir: dir }
}

fn payload(v: Value) -> Value {
    json!({ "payload": v.to_string() })
}

/// `args` with `callId` set to `id`.
fn with_call(mut args: Value, id: &str) -> Value {
    args["callId"] = json!(id);
    args
}

/// A call each command can answer with success, from a fresh journal.
fn answerable(key: &str) -> Vec<(&'static str, Value)> {
    vec![
        (
            "agent_journal_capture",
            payload(json!({
                "docKey": key, "window": "main/t1", "observedParent": null,
                "postimage": "first", "initiator": Actor::Human,
            })),
        ),
        ("agent_journal_status", json!({})),
        ("agent_journal_checkpoints", json!({})),
        (
            "agent_journal_checkpoints_forget",
            payload(json!({ "ids": [] })),
        ),
        ("agent_journal_history", payload(json!({ "docKey": key }))),
        (
            "agent_journal_uncommitted",
            payload(json!({ "docKey": key })),
        ),
        (
            "agent_journal_find_document",
            payload(json!({ "docKey": key })),
        ),
        (
            "agent_journal_find_document",
            payload(json!({ "docKey": "path:/never.md" })),
        ),
        ("agent_journal_head", payload(json!({ "docKey": key }))),
        (
            "agent_journal_head",
            payload(json!({ "docKey": "path:/never.md" })),
        ),
        (
            "agent_journal_bind_document",
            payload(json!({ "from": key, "to": "path:/moved.md" })),
        ),
        (
            "agent_journal_release_window",
            json!({ "window": "main/t1" }),
        ),
        (
            "comment_user_list",
            payload(json!({ "docKey": key, "text": "" })),
        ),
        (
            "comment_agent_list",
            payload(json!({ "docKey": key, "text": "" })),
        ),
    ]
}

#[test]
fn each_call_bound_command_echoes_its_call_id_around_the_unchanged_reply() {
    let r = ready();
    let caller = window(&r.app, "main");
    for (command, args) in answerable("path:/a.md") {
        let out = invoke_from(&caller, command, with_call(args, CALL))
            .unwrap_or_else(|e| panic!("{command}: {e}"));
        assert_eq!(out["bind"], json!({ "callId": CALL }), "{command}: {out}");
        assert!(out.get("reply").is_some(), "{command}: {out}");
        assert_eq!(
            out.as_object().map(|o| o.len()),
            Some(2),
            "{command}: {out}"
        );
    }

    // An epoch armed and then closed: the unit reply is enveloped too.
    let armed = invoke_from(
        &caller,
        "agent_journal_arm_epoch",
        with_call(payload(json!({ "docKey": "path:/moved.md" })), CALL),
    )
    .expect("arm");
    assert_eq!(armed["bind"], json!({ "callId": CALL }));
    let epoch = armed["reply"]["epoch"].clone();
    let other = "f".repeat(32);
    let closed = invoke_from(
        &caller,
        "agent_journal_close_epoch",
        with_call(
            payload(json!({ "docKey": "path:/moved.md", "epoch": epoch })),
            &other,
        ),
    )
    .expect("close");
    assert_eq!(
        closed,
        json!({ "bind": { "callId": other }, "reply": null })
    );
}

#[test]
fn a_missing_or_malformed_call_id_is_refused_before_the_command_runs() {
    let r = ready();
    let caller = window(&r.app, "main");
    let key = "path:/a.md";
    let len = || {
        r.app
            .state::<AgentJournalState>()
            .writer()
            .expect("ready")
            .lock()
            .journal
            .len()
    };
    let before = len();
    let short = "0".repeat(31);
    let long = "0".repeat(33);
    let upper = "A".repeat(32);
    let not_hex = "g".repeat(32);
    let mut calls = answerable(key);
    calls.push(("agent_journal_arm_epoch", payload(json!({ "docKey": key }))));
    calls.push((
        "agent_journal_discard",
        payload(json!({ "docKey": key, "txn": "x" })),
    ));
    calls.push((
        "agent_journal_git_export",
        payload(json!({ "docKey": key, "repository": "/nowhere" })),
    ));
    calls.push((
        "agent_journal_close_epoch",
        payload(json!({ "docKey": key, "epoch": "1" })),
    ));
    calls.push((
        "agent_journal_review_decide",
        payload(json!({
            "docKey": key, "expectedHead": null, "action": "keep",
            "items": [{ "hunkId": "h", "expectedReviewGen": "0" }],
        })),
    ));
    calls.push((
        "agent_journal_concurrent_pair",
        payload(json!({ "docKey": key, "revision": uuid::Uuid::nil().to_string() })),
    ));
    let state = json!({ "docKey": key, "comment": "c1", "expectedCommentGen": "0" });
    for command in [
        "comment_user_mark_addressed",
        "comment_user_resolve",
        "comment_user_reopen",
        "comment_user_delete",
        "comment_agent_mark_addressed",
    ] {
        calls.push((command, payload(state.clone())));
    }
    let mut swept: Vec<&str> = calls.iter().map(|(c, _)| *c).collect();
    swept.sort_unstable();
    swept.dedup();
    let mut want = CALL_BOUND.to_vec();
    want.sort_unstable();
    assert_eq!(swept, want, "every call-bound command is swept");
    for (command, args) in &calls {
        invoke_from(&caller, command, args.clone())
            .expect_err(&format!("{command} without a callId"));
        for bad in [&short, &long, &upper, &not_hex, &String::new()] {
            let err = invoke_from(&caller, command, with_call(args.clone(), bad))
                .expect_err(&format!("{command} with callId {bad:?}"));
            assert_eq!(
                err["detail"]["journalCode"], "INVALID_REQUEST",
                "{command}/{bad:?}: {err}"
            );
            assert!(
                err["message"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("callId"),
                "{command}/{bad:?}: {err}"
            );
        }
    }
    assert_eq!(len(), before, "no refused call appended a record");
    let found = invoke_from(
        &caller,
        "agent_journal_find_document",
        with_call(payload(json!({ "docKey": key })), CALL),
    )
    .expect("find");
    assert_eq!(
        found["reply"],
        Value::Null,
        "no refused call minted a document"
    );
}

/// The source of a module, by its path in `all_commands!`.
fn module_source(path: &str) -> &'static str {
    match path {
        "agent_journal::commands" => include_str!("commands.rs"),
        "agent_journal::commands::document" => include_str!("commands_document.rs"),
        "agent_journal::commands_history" => include_str!("commands_history.rs"),
        "agent_journal::git_export::command" => include_str!("git_export/command.rs"),
        "agent_journal::comment::commands_user" => include_str!("comment/commands_user.rs"),
        "agent_journal::comment::commands_agent" => include_str!("comment/commands_agent.rs"),
        other => panic!("journal command module {other} is not known to this test: add it"),
    }
}

/// `name`'s signature: from `pub async fn name` to the body's `{`.
fn signature<'a>(source: &'a str, name: &str) -> &'a str {
    let start = source
        .find(&format!("pub async fn {name}<"))
        .or_else(|| source.find(&format!("pub async fn {name}(")))
        .unwrap_or_else(|| panic!("{name} not found in its module"));
    let rest = &source[start..];
    &rest[..rest.find(" {\n").expect("signature ends")]
}

#[test]
fn every_journal_command_reply_is_bound() {
    let registry = include_str!("../command_registry.rs");
    let entries: Vec<(&str, &str)> = registry
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("agent_journal::"))
        .map(|l| {
            let path = l.trim_end_matches(',');
            let (module, name) = path.rsplit_once("::").expect("module path");
            (module, name)
        })
        .collect();
    assert!(
        entries.len() >= 19,
        "the registry lists the journal commands"
    );

    let mut call_bound = Vec::new();
    for (module, name) in &entries {
        let sig = signature(module_source(module), name);
        let returns = &sig[sig.find("->").expect("returns")..];
        match *name {
            // R98: bound by the request's own id and digest, or its pair.
            "agent_journal_prepare"
            | "agent_journal_restore_prepare"
            | "agent_journal_revert_prepare"
            | "comment_user_create"
            | "comment_user_reply"
            | "comment_agent_reply" => {
                assert!(returns.contains("Bound<RequestBind"), "{name}: {sig}")
            }
            "agent_journal_commit" | "agent_journal_abort" => {
                assert!(returns.contains("Bound<PairBind"), "{name}: {sig}")
            }
            // R98: the registration's `wire()` is `{bind: {pageIdentity}, reply}`.
            "agent_journal_register_page" => {
                assert!(returns.contains("Value"), "{name}: {sig}")
            }
            // R98: the abandon's answers name the request id, which the client validates.
            "agent_journal_abandon" => {}
            _ => {
                assert!(
                    sig.contains("call_id: String"),
                    "{name} takes no callId: {sig}"
                );
                assert!(
                    returns.contains("Bound<CallBind"),
                    "{name} does not echo its callId: {sig}"
                );
                call_bound.push(*name);
            }
        }
    }
    let mut want = CALL_BOUND.to_vec();
    want.sort_unstable();
    call_bound.sort_unstable();
    assert_eq!(
        call_bound, want,
        "the call-bound commands are exactly these"
    );
}
