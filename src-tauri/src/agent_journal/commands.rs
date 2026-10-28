//! Tauri commands of the agent edit journal: the status query and the
//! controlled-write protocol (`register_page`, then `prepare` → `commit` |
//! `abort`, or `abandon`) a window runs for its agent writes, the capture of a save, the editing epochs a
//! window's provenance maps are certified under, and the release of a
//! closed window's base root. Carrying a document to a new key or looking
//! one up is in `document` (`commands_document.rs`).
//!
//! Key decisions:
//!   - `async` + `spawn_blocking` (`run`, `on_state`): every write fsyncs
//!     under the writer lock, which must never run on the main thread nor
//!     stall an async worker; a read that may wait for that lock does too.
//!   - Payloads arrive as JSON strings, not typed arguments, so a lone
//!     surrogate escaped by `JSON.stringify` reaches the well-formed-text
//!     check and is refused as `INVALID_TEXT` instead of being replaced.
//!   - The agent-write protocol is identity-carrying: a prepare's frozen
//!     payload names the writer's incarnation and the page's pair, commit
//!     and abort name the pair, and the page is registered first
//!     (`agent_journal_register_page`). The caller's label is always the
//!     invoking webview's, never an argument. Success replies travel in
//!     `{bind, reply}` envelopes (`admission::bound`).
//!   - Every other command takes the caller's `callId` and echoes it as
//!     `{bind: {callId}, reply}`, so a reply delivered to the wrong call is
//!     caught before it is read. A malformed id is refused before the
//!     command runs.
//!   - No journal (still starting, or failed to open) is a `conflict` with
//!     `journalCode: JOURNAL_UNAVAILABLE`; the caller does not write. A
//!     journal a newer build wrote refuses as `JOURNAL_FUTURE_FORMAT`.
//!
//! @module agent_journal/commands

use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

use crate::agent_journal::admission::bound::{
    bind_call, AbandonReply, Bound, CallBind, PairBind, RequestBind,
};
use crate::agent_journal::capture::CaptureReply;
use crate::agent_journal::controlled::{ControlledCommitted, ControlledPrepared};
use crate::agent_journal::controller::{AbortReply, Controller, EpochReply};
use crate::agent_journal::service::{register_window_page, AgentJournalState, AgentJournalStatus};
use crate::command_error::CommandError;

#[path = "debug_pause.rs"]
mod debug_pause;
#[path = "commands_document.rs"]
pub mod document;

/// Where the journal's startup stands: starting, ready (with generation,
/// health and the legacy import report) or failed (with the reason).
///
/// `async` so a query never runs on the main thread behind the writer lock.
///
/// # Errors
/// None today; the `Result` keeps the crate-wide command contract.
#[tauri::command]
pub async fn agent_journal_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    call_id: String,
) -> Result<Bound<CallBind, AgentJournalStatus>, CommandError> {
    bind_call(&call_id, on_state(app, |s| Ok(s.status()))).await
}

/// Run `f` on the managed journal state on the blocking pool, since it
/// may wait for the writer lock.
pub(super) async fn on_state<R: tauri::Runtime, T: Send + 'static>(
    app: tauri::AppHandle<R>,
    f: impl FnOnce(&AgentJournalState) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tokio::task::spawn_blocking(move || f(&app.state::<AgentJournalState>()))
        .await
        .map_err(task_failed)?
}

fn task_failed(e: tokio::task::JoinError) -> CommandError {
    CommandError::internal(format!("journal task failed: {e}"))
}

pub(super) async fn run<T: Send + 'static>(
    state: &AgentJournalState,
    f: impl FnOnce(Controller) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    let c = state.controller().ok_or_else(|| state.off_refusal())?;
    tokio::task::spawn_blocking(move || f(c))
        .await
        .map_err(task_failed)?
}

/// Prepare a controlled write from a frozen payload (JSON `{docKey,
/// parent, preimage, actor, tool, …, requestId, incarnation,
/// webviewGeneration, pageIdentity}`) for the invoking page. Replies
/// `{bind: {requestId, digest}, reply}`.
///
/// # Errors
/// A journal refusal (`detail.journalCode`; a request answer adds
/// `uncertain` and `request`), or the off refusal.
#[tauri::command]
pub async fn agent_journal_prepare<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
) -> Result<Bound<RequestBind, ControlledPrepared>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| c.prepare_framed(&pages, &label, &payload)).await
}

/// Commit an open transaction (`payload`: JSON `{postimage}`) for the page
/// pair that prepared it. Replies `{bind: {txn, pageIdentity,
/// webviewGeneration}, reply}`.
///
/// # Errors
/// `STALE_PAGE` for a page that is gone; a journal refusal otherwise; a
/// failed append is `durable: false`, not an error.
#[tauri::command]
pub async fn agent_journal_commit<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    txn: String,
    payload: String,
    page_identity: String,
    webview_generation: String,
) -> Result<Bound<PairBind, ControlledCommitted>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| {
        c.commit_owned(
            &pages,
            &label,
            &txn,
            &payload,
            &page_identity,
            &webview_generation,
        )
    })
    .await
}

/// Abort an open transaction for the page pair that prepared it; `reason`
/// is `edited`, `closed`, `composing`, `selection`, `applyRefused` or
/// `timedOut`. Replies `{bind: {txn, pageIdentity, webviewGeneration},
/// reply: {durable}}`.
///
/// # Errors
/// As `agent_journal_commit`.
#[tauri::command]
pub async fn agent_journal_abort<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    txn: String,
    reason: String,
    page_identity: String,
    webview_generation: String,
) -> Result<Bound<PairBind, AbortReply>, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| {
        c.abort_owned(
            &pages,
            &label,
            &txn,
            &reason,
            &page_identity,
            &webview_generation,
        )
    })
    .await
}

/// Give up on the request a frozen payload sent: the payload is the
/// prepare's, byte for byte, and only its own `requestId` and identity
/// fields are read; nothing beside it in the arguments is.
///
/// # Errors
/// `INVALID_REQUEST` for a payload that does not decode; a request answer
/// otherwise; the off refusal while no journal is open.
#[tauri::command]
pub async fn agent_journal_abandon<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
) -> Result<AbandonReply, CommandError> {
    let pages = state.pages().clone();
    let label = webview.label().to_owned();
    run(&state, move |c| c.abandon(&pages, &label, &payload)).await
}

/// The pair a registration replaces: the caller's own previous one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Replaces {
    page_identity: String,
    webview_generation: String,
}

/// Register the invoking page (`pageIdentity`: 32 hex) under its webview's
/// label, replacing `replaces` when given. Replies `{bind: {pageIdentity},
/// reply: {incarnation, webviewGeneration, pageIdentity}}`. The label is
/// the invoking webview's, never an argument. A debug build can hold a
/// successful reply after the registration executes (`debug_pause`).
///
/// # Errors
/// The off refusal before anything is minted while no journal is open;
/// `STALE_REQUEST` (uncertain) for a window that is not open; the page
/// table's refusals otherwise.
#[tauri::command]
pub async fn agent_journal_register_page<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    page_identity: String,
    replaces: Option<Replaces>,
) -> Result<Value, CommandError> {
    let replaces = replaces
        .as_ref()
        .map(|r| (r.page_identity.as_str(), r.webview_generation.as_str()));
    let app = webview.app_handle();
    let registered = register_window_page(app, webview.label(), &page_identity, replaces);
    #[cfg(debug_assertions)]
    if let Ok(r) = &registered {
        debug_pause::after_register(webview.label(), r.page_identity.as_str()).await;
    }
    registered.map(|r| r.wire())
}

/// Record a save (`payload`: JSON `{docKey, window, observedParent,
/// postimage, initiator}`). The save itself already happened.
///
/// # Errors
/// A journal refusal; a failed append is `journaled: "no"`, not an error.
#[tauri::command]
pub async fn agent_journal_capture(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, CaptureReply>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.capture(&payload))).await
}

/// Arm the next editing epoch of a document (`payload`: JSON `{docKey}`);
/// replies `{doc, epoch}` with `epoch` a decimal string.
///
/// # Errors
/// `INVALID_REQUEST` while an epoch is armed; a journal refusal otherwise.
#[tauri::command]
pub async fn agent_journal_arm_epoch(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, EpochReply>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.arm_epoch(&payload))).await
}

/// Close a document's armed epoch (`payload`: JSON `{docKey, epoch}`).
///
/// # Errors
/// `INVALID_REQUEST` when `epoch` is not the armed one.
#[tauri::command]
pub async fn agent_journal_close_epoch(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, ()>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.close_epoch(&payload))).await
}

/// A window closed a document: release its base root (`window`:
/// `<window>/<tab>`). Idempotent.
///
/// # Errors
/// `INVALID_REQUEST` for an empty or over-long name.
#[tauri::command]
pub async fn agent_journal_release_window(
    state: tauri::State<'_, AgentJournalState>,
    window: String,
    call_id: String,
) -> Result<Bound<CallBind, ()>, CommandError> {
    bind_call(&call_id, run(&state, move |c| c.release_window(&window))).await
}

#[cfg(all(test, not(target_os = "windows")))]
#[path = "abandon_dispatch.test.rs"]
mod abandon_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "call_bind_dispatch.test.rs"]
mod call_bind_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "commands_dispatch.test.rs"]
pub(crate) mod commands_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "future_format_dispatch.test.rs"]
mod future_format_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "revert_dispatch.test.rs"]
mod revert_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "review_decide_dispatch.test.rs"]
mod review_decide_dispatch;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "status_blocking.test.rs"]
mod status_blocking;
