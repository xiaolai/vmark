// WI-AL3.2 — the comment_user_* and comment_agent_* command families through real IPC dispatch: every cell of R36's matrix through the command a webview would call (an allowed cell moves the thread, a refused one is COMMENT_NOT_ALLOWED, and an agent resolve, reopen or delete has no command at all; every refusal appends nothing); the caller recorded is the family's, never a request field (a forged caller or actor is INVALID_REQUEST); the split: the agent family is exactly create, reply, markAddressed and the read-only list (WI-AL3.3), and its module never names the user handle; and the user list, resolve, reopen and delete replies travel in their callId envelopes
//! Gated off Windows, where `tauri::test` does not exist.

use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::WebviewWindow;

use crate::agent_journal::admission::admission_support::KEY;
use crate::agent_journal::commands;
use crate::agent_journal::commands::commands_dispatch::{frame, ready_with, App, Page};
use crate::agent_journal::comment::comment_rules_tests::MATRIX;
use crate::agent_journal::comment::ids::{CommentCaller, ThreadState};
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::comment::{commands_agent, commands_user};
use crate::agent_journal::service::AgentJournalState;
use crate::agent_journal::test_support::agent;
use crate::ipc_caller::invoke_from;

const TEXT: &str = "# Title\n\nhello world\n";
const CALL: &str = "0123456789abcdef0123456789abcdef";

fn app() -> App {
    let app = tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_journal_register_page,
            commands_user::comment_user_create,
            commands_user::comment_user_reply,
            commands_user::comment_user_mark_addressed,
            commands_user::comment_user_resolve,
            commands_user::comment_user_reopen,
            commands_user::comment_user_delete,
            commands_user::comment_user_list,
            commands_agent::comment_agent_reply,
            commands_agent::comment_agent_mark_addressed,
            commands_agent::comment_agent_list,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    ready_with(app)
}

fn family(caller: CommentCaller) -> &'static str {
    match caller {
        CommentCaller::User => "user",
        CommentCaller::Agent => "agent",
    }
}

fn command(caller: CommentCaller, action: Action) -> String {
    let verb = match action {
        Action::Reply => "reply",
        Action::MarkAddressed => "mark_addressed",
        Action::Resolve => "resolve",
        Action::Reopen => "reopen",
        Action::Delete => "delete",
    };
    format!("comment_{}_{verb}", family(caller))
}

fn create_body(caller: CommentCaller) -> Value {
    let mut b = json!({
        "docKey": KEY,
        "parent": null,
        "text": TEXT,
        "selection": { "start": 9, "end": 14, "precision": "exact" },
        "body": "look",
        "author": "Reviewer",
    });
    if caller == CommentCaller::Agent {
        b["actor"] = serde_json::to_value(agent()).expect("actor");
    }
    b
}

/// The parent the next create names: the document's head, once there is one.
fn with_head(a: &App, mut b: Value) -> Value {
    let doc = a.writer().lock().proj.docs.keys().next().copied();
    b["parent"] = json!(doc.and_then(|d| a.writer().head(d)));
    b
}

/// A thread created through `comment_user_create`, the one create command.
fn create(a: &App, page: &Page) -> Result<Value, Value> {
    let body = with_head(a, create_body(CommentCaller::User));
    invoke_from(
        &page.win,
        "comment_user_create",
        json!({ "payload": frame(page, body) }),
    )
}

/// `action` by `caller` on `comment` at `gen`, as the webview calls it.
fn attempt(
    page: &Page,
    caller: CommentCaller,
    action: Action,
    comment: &str,
    gen: u64,
) -> Result<Value, Value> {
    let cmd = command(caller, action);
    if action == Action::Reply {
        let body = json!({
            "docKey": KEY, "comment": comment, "body": "cell",
            "author": "Reviewer", "expectedCommentGen": gen.to_string(),
        });
        return invoke_from(&page.win, &cmd, json!({ "payload": frame(page, body) }));
    }
    let payload =
        json!({ "docKey": KEY, "comment": comment, "expectedCommentGen": gen.to_string() });
    invoke_from(
        &page.win,
        &cmd,
        json!({ "payload": payload.to_string(), "callId": CALL }),
    )
}

/// A fresh user thread brought to `state` through the user commands.
fn at(a: &App, page: &Page, state: ThreadState) -> (String, u64) {
    let out = create(a, page).expect("create");
    let c = out["reply"]["comment"]
        .as_str()
        .expect("comment")
        .to_owned();
    let step = |action, g| {
        attempt(page, CommentCaller::User, action, &c, g).expect("setup step");
    };
    let g = match state {
        ThreadState::Open => 0,
        ThreadState::Addressed => (step(Action::MarkAddressed, 0), 1).1,
        ThreadState::Resolved => (step(Action::Resolve, 0), 1).1,
        ThreadState::Reopened => {
            step(Action::Resolve, 0);
            step(Action::Reopen, 1);
            2
        }
    };
    (c, g)
}

fn list(win: &WebviewWindow<MockRuntime>, text: &str) -> Value {
    let payload = json!({ "docKey": KEY, "text": text }).to_string();
    let out = invoke_from(
        win,
        "comment_user_list",
        json!({ "payload": payload, "callId": CALL }),
    )
    .expect("list");
    assert_eq!(out["bind"], json!({ "callId": CALL }));
    out["reply"].clone()
}

fn thread<'a>(listed: &'a Value, c: &str) -> Option<&'a Value> {
    listed["threads"]
        .as_array()
        .expect("threads")
        .iter()
        .find(|t| t["comment"] == json!(c))
}

#[test]
fn every_cell_of_the_r36_matrix_holds_through_the_command_families() {
    let a = app();
    let page = a.page("doc-a", 1);
    for (from, caller, action, want) in MATRIX {
        let what = format!("{} from {from:?}", command(caller, action));
        let (c, g) = at(&a, &page, from);
        let len = a.journal_len();
        let got = attempt(&page, caller, action, &c, g);
        let listed = list(&page.win, TEXT);
        match (want, got) {
            (Some(_), Ok(_)) if action == Action::Delete => {
                assert!(thread(&listed, &c).is_none(), "{what}: deleted");
            }
            (Some(to), Ok(out)) => {
                let t = thread(&listed, &c).expect("listed");
                let to = serde_json::to_value(to).expect("state");
                assert_eq!(t["state"], to, "{what}");
                assert_eq!(t["commentGen"], json!((g + 1).to_string()), "{what}");
                if action == Action::Reply {
                    let last = t["replies"]
                        .as_array()
                        .and_then(|r| r.last())
                        .expect("reply");
                    assert_eq!(last["caller"], json!(family(caller)), "{what}: caller");
                } else {
                    assert_eq!(out["bind"], json!({ "callId": CALL }), "{what}");
                    assert_eq!(out["reply"]["state"], to, "{what}");
                }
            }
            (None, Err(err)) => {
                let offered = caller == CommentCaller::User
                    || matches!(action, Action::Reply | Action::MarkAddressed);
                if offered {
                    assert_eq!(
                        err["detail"]["journalCode"], "COMMENT_NOT_ALLOWED",
                        "{what}: {err}"
                    );
                }
                assert_eq!(a.journal_len(), len, "{what}: a refusal appends nothing");
                let t = thread(&listed, &c).expect("still listed");
                assert_eq!(t["commentGen"], json!(g.to_string()), "{what}");
            }
            (want, got) => panic!("{what}: the matrix says {want:?}, the command gave {got:?}"),
        }
    }
}

#[test]
fn the_caller_is_the_family_and_a_forged_caller_or_actor_is_refused() {
    let a = app();
    let page = a.page("doc-a", 1);
    let user_made = create(&a, &page).expect("user create");
    let listed = list(&page.win, TEXT);
    let caller_of = |out: &Value| {
        let c = out["reply"]["comment"].as_str().expect("comment");
        thread(&listed, c).expect("listed")["caller"].clone()
    };
    assert_eq!(caller_of(&user_made), json!("user"));

    let len = a.journal_len();
    let mut forged_caller = with_head(&a, create_body(CommentCaller::User));
    forged_caller["caller"] = json!("agent");
    let mut user_with_actor = with_head(&a, create_body(CommentCaller::Agent));
    user_with_actor["body"] = json!("forged");
    for (cmd, body) in [
        ("comment_user_create", forged_caller),
        ("comment_user_create", user_with_actor),
    ] {
        let err =
            invoke_from(&page.win, cmd, json!({ "payload": frame(&page, body) })).expect_err(cmd);
        assert_eq!(
            err["detail"]["journalCode"], "INVALID_REQUEST",
            "{cmd}: {err}"
        );
    }
    assert_eq!(a.journal_len(), len, "no forged create appended");
}

#[test]
fn an_agent_cannot_create_a_thread_over_ipc() {
    let a = app();
    let page = a.page("doc-a", 1);
    let len = a.journal_len();
    let body = with_head(&a, create_body(CommentCaller::Agent));
    let err = invoke_from(
        &page.win,
        "comment_agent_create",
        json!({ "payload": frame(&page, body) }),
    )
    .expect_err("no agent create command");
    assert!(
        err.to_string().contains("comment_agent_create"),
        "an unknown command, not a journal refusal: {err}"
    );
    assert_eq!(a.journal_len(), len, "nothing appended");
}

#[test]
fn the_agent_family_is_exactly_reply_mark_addressed_and_list() {
    let registry = include_str!("../command_registry.rs");
    let registered = |prefix: &str| -> Vec<&str> {
        let mut names: Vec<&str> = registry
            .lines()
            .map(|l| l.trim().trim_end_matches(','))
            .filter_map(|l| l.rsplit_once("::").map(|(_, n)| n))
            .filter(|n| n.starts_with(prefix))
            .collect();
        names.sort_unstable();
        names
    };
    assert_eq!(
        registered("comment_agent_"),
        [
            "comment_agent_list",
            "comment_agent_mark_addressed",
            "comment_agent_reply"
        ]
    );
    assert_eq!(
        registered("comment_user_"),
        [
            "comment_user_create",
            "comment_user_delete",
            "comment_user_list",
            "comment_user_mark_addressed",
            "comment_user_reopen",
            "comment_user_reply",
            "comment_user_resolve",
        ]
    );
    let agent_src = include_str!("comment/commands_agent.rs");
    let user_src = include_str!("comment/commands_user.rs");
    let code = |src: &'static str| -> String {
        src.lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert!(
        !code(agent_src).contains("comments_user"),
        "the agent family reaches the user handle"
    );
    assert!(
        !code(user_src).contains("comments_agent"),
        "the user family reaches the agent handle"
    );
    assert_eq!(code(agent_src).matches("#[tauri::command]").count(), 3);
    assert_eq!(code(agent_src).matches("comments_agent()").count(), 3);
    for verb in ["create", "resolve", "reopen", "delete"] {
        let name = format!("comment_agent_{verb}");
        assert!(
            !code(agent_src).contains(&name),
            "the agent family has {name}"
        );
    }
    assert_eq!(code(user_src).matches("comments_user()").count(), 7);
}

#[test]
fn a_journal_that_is_not_ready_refuses_every_comment_command() {
    let app = tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .invoke_handler(tauri::generate_handler![
            commands_user::comment_user_list,
            commands_agent::comment_agent_mark_addressed,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let win = crate::ipc_caller::window(&app, "main");
    let payload = json!({ "docKey": KEY, "text": TEXT }).to_string();
    let err = invoke_from(
        &win,
        "comment_user_list",
        json!({ "payload": payload, "callId": CALL }),
    )
    .expect_err("not ready");
    assert_eq!(err["detail"]["journalCode"], "JOURNAL_UNAVAILABLE", "{err}");
    let state = json!({ "docKey": KEY, "comment": "c1", "expectedCommentGen": "0" }).to_string();
    let err = invoke_from(
        &win,
        "comment_agent_mark_addressed",
        json!({ "payload": state, "callId": CALL }),
    )
    .expect_err("not ready");
    assert_eq!(err["detail"]["journalCode"], "JOURNAL_UNAVAILABLE", "{err}");
}

#[test]
fn the_agent_list_replies_as_the_user_list_does() {
    let a = app();
    let page = a.page("doc-a", 1);
    create(&a, &page).expect("create");
    let payload = json!({ "docKey": KEY, "text": TEXT }).to_string();
    let out = invoke_from(
        &page.win,
        "comment_agent_list",
        json!({ "payload": payload, "callId": CALL }),
    )
    .expect("agent list");
    assert_eq!(out["bind"], json!({ "callId": CALL }));
    assert_eq!(out["reply"], list(&page.win, TEXT));
}
