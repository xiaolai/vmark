//! Tauri commands of an agent's comment threads: reply, `markAddressed` and
//! the read-only list, nothing else. Every command reaches the agent handle
//! (`Controller::comments_agent`), so each record they write names the
//! `agent` caller.
//!
//! Key decisions:
//!   - The family is exactly these three commands: there is no agent
//!     create, resolve, reopen or delete to call, so the refusal is
//!     structural, not a state check the caller could talk its way past.
//!     (The MCP `comments` tool offers no create, so none is registered.)
//!   - The list is the user's list, from the same code (`Controller::
//!     comment_list`) and in the same reply shape; reading moves nothing.
//!   - This module never names the user handle (pinned by the split test).
//!   - Same contract as `commands_user` otherwise.
//!
//! @module agent_journal/comment/commands_agent

use crate::agent_journal::admission::bound::{bind_call, Bound, CallBind, RequestBind};
use crate::agent_journal::commands::run;
use crate::agent_journal::comment::commands_user::state_call;
use crate::agent_journal::comment::list::CommentList;
use crate::agent_journal::comment::replies::{CommentRepliedReply, CommentStateReply};
use crate::agent_journal::service::AgentJournalState;
use crate::command_error::CommandError;

/// Reply to a thread that is not resolved, from a frozen payload; replies
/// `{bind: {requestId, digest}, reply}`.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn comment_agent_reply<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
) -> Result<Bound<RequestBind, CommentRepliedReply>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| {
        c.comments_agent().reply(&pages, &label, &payload)
    })
    .await
}

/// Mark an open or reopened thread addressed (`payload`: JSON `{docKey,
/// comment, expectedCommentGen}`); replies `{bind: {callId}, reply}`.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn comment_agent_mark_addressed(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, CommentStateReply>, CommandError> {
    state_call(&state, payload, &call_id, |c, req| {
        c.comments_agent().mark_addressed(req)?.into_state()
    })
    .await
}

/// The document's threads against the window's text (`payload`: JSON
/// `{docKey, text}`), exactly as `comment_user_list` replies; replies
/// `{bind: {callId}, reply}`.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn comment_agent_list(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, CommentList>, CommandError> {
    bind_call(
        &call_id,
        run(&state, move |c| c.comments_agent().list(&payload)),
    )
    .await
}
