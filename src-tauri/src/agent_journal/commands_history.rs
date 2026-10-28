//! Tauri commands of the history panel over the agent edit journal: prepare
//! a restore or a hunk revert (committed or aborted through `agent_journal_commit` /
//! `agent_journal_abort`), list a document's revisions, read both pairs of a revision edited in
//! two windows (`controller_concurrent_pair`), list or discard a document's uncommitted
//! entries, keep the panel's checkpoints (`controller_checkpoints`), and record
//! the review panel's decisions (`controller::review`).
//!
//! Key decisions:
//!   - Same contract as `commands`: `async` + `spawn_blocking`, JSON string
//!     payloads, `JOURNAL_UNAVAILABLE` when no journal is open, and a
//!     reply bound to the caller's request id or `callId`.
//!
//! @module agent_journal/commands_history

use crate::agent_journal::admission::bound::{bind_call, Bound, CallBind, RequestBind};
use crate::agent_journal::commands::run;
use crate::agent_journal::controlled_restore::RestorePrepared;
use crate::agent_journal::controlled_revert::RevertReply;
use crate::agent_journal::controller::review::ReviewDecided;
use crate::agent_journal::controller::AbortReply;
use crate::agent_journal::controller_checkpoints::CheckpointView;
use crate::agent_journal::controller_concurrent_pair::ConcurrentPair;
use crate::agent_journal::controller_doc_history::DocHistory;
use crate::agent_journal::controller_history::UncommittedEntry;
use crate::agent_journal::service::AgentJournalState;
use crate::agent_journal::writer_checkpoints::ForgetReport;
use crate::command_error::CommandError;

/// Prepare a restore from a frozen payload (JSON `{docKey, parent,
/// preimage, source, baselineProvenance?, baselineTouched?, requestId,
/// incarnation, webviewGeneration, pageIdentity}`) for the invoking page;
/// replies `{bind: {requestId, digest}, reply}` with the text to apply.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn agent_journal_restore_prepare<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
) -> Result<Bound<RequestBind, RestorePrepared>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| {
        c.restore_prepare_framed(&pages, &label, &payload)
    })
    .await
}

/// Prepare a revert of one hunk from a frozen payload (JSON `{docKey,
/// parent, observedParent, preimage, hunkId, expectedReviewGen,
/// baselineProvenance?, baselineTouched?, capture?, requestId,
/// incarnation, webviewGeneration, pageIdentity}`) for the invoking page;
/// replies `{bind: {requestId, digest}, reply: {kind, response}}`: kind
/// `prepared` with the patch to apply, or `decided` with the review
/// decision recorded instead.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn agent_journal_revert_prepare<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
) -> Result<Bound<RequestBind, RevertReply>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| {
        c.revert_prepare_framed(&pages, &label, &payload)
    })
    .await
}

/// Record one review decision (JSON `{docKey, expectedHead, action,
/// items: [{hunkId, expectedReviewGen}]}`; `action` is `keep`, `unkeep`,
/// `markHandled` or `clearReviewed`); replies `{bind: {callId}, reply:
/// {generation}}`.
///
/// # Errors
/// A journal refusal (`detail.journalCode`), or the off refusal.
#[tauri::command]
pub async fn agent_journal_review_decide(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, ReviewDecided>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.review_decide(&payload))).await
}

/// A document's revisions and blocked hunks (`payload`: JSON `{docKey}`).
///
/// # Errors
/// An invalid payload or key, or `JOURNAL_UNAVAILABLE`.
#[tauri::command]
pub async fn agent_journal_history(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, DocHistory>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.history(&payload))).await
}

/// Both pairs of a concurrent revision (`payload`: JSON `{docKey,
/// revision}`): its observed before-text, its linear before-text and its
/// postimage.
///
/// # Errors
/// `INVALID_REQUEST` for a malformed payload or a revision that is not a
/// concurrent revision of that document; `JOURNAL_CORRUPT` for a missing
/// text; `JOURNAL_UNAVAILABLE`.
#[tauri::command]
pub async fn agent_journal_concurrent_pair(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, ConcurrentPair>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.concurrent_pair(&payload))).await
}

/// A document's uncommitted entries (`payload`: JSON `{docKey}`).
///
/// # Errors
/// An invalid payload or key, or `JOURNAL_UNAVAILABLE`.
#[tauri::command]
pub async fn agent_journal_uncommitted(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, Vec<UncommittedEntry>>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.uncommitted(&payload))).await
}

/// Discard one uncommitted entry (`payload`: JSON `{docKey, txn}`).
///
/// # Errors
/// `INVALID_REQUEST` when it is not that document's uncommitted entry.
#[tauri::command]
pub async fn agent_journal_discard(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, AbortReply>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.discard(&payload))).await
}

/// Every checkpoint of the history panel, in the order they were written.
///
/// # Errors
/// A checkpoint's text cannot be read, or `JOURNAL_UNAVAILABLE`.
#[tauri::command]
pub async fn agent_journal_checkpoints(
    state: tauri::State<'_, AgentJournalState>,
    call_id: String,
) -> Result<Bound<CallBind, Vec<CheckpointView>>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.checkpoints())).await
}

/// Delete checkpoints (`payload`: JSON `{ids}`) from the journal.
///
/// # Errors
/// `INVALID_REQUEST` for a malformed payload, or `JOURNAL_UNAVAILABLE`.
#[tauri::command]
pub async fn agent_journal_checkpoints_forget(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, ForgetReport>, CommandError> {
    bind_call(
        &call_id,
        run(&state, move |c| c.checkpoints_forget(&payload)),
    )
    .await
}
