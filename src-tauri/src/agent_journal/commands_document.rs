//! Tauri commands that carry a document to a new key (Save As, in-app
//! rename), look up the document a key carries (both work before the
//! journal is ready), or read its settled head.
//!
//! Key decisions:
//!   - Same contract as `commands`: the blocking pool (`on_state`) for the durable bind,
//!     JSON string payloads, and a reply bound to the caller's `callId`.
//!
//! @module agent_journal/commands/document

use super::on_state;
use crate::agent_journal::admission::bound::{bind_call, Bound, CallBind};
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::command_error::CommandError;

/// Carry a document to a new key on Save As or in-app rename (`payload`:
/// JSON `{from, to, expectedDoc?}`; `expectedDoc` absent checks nothing,
/// `null` requires `from` to carry no document, an id requires that one).
/// Replies the document the destination carries now. Works before the
/// journal is ready.
///
/// # Errors
/// `INVALID_REQUEST` for a malformed payload or a source that no longer
/// carries `expectedDoc`; `JOURNAL_IO` when the bind cannot be made durable.
#[tauri::command]
pub async fn agent_journal_bind_document<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, DocId>, CommandError> {
    bind_call(&call_id, on_state(app, move |s| s.bind_document(&payload))).await
}

/// The document a key carries, without minting one (`payload`: JSON
/// `{docKey}`); replies the id or `null`. Works before the journal is
/// ready.
///
/// # Errors
/// `INVALID_REQUEST` for a malformed payload or key.
#[tauri::command]
pub async fn agent_journal_find_document<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, Option<DocId>>, CommandError> {
    bind_call(&call_id, on_state(app, move |s| s.find_document(&payload))).await
}

/// The settled head of the document a key carries (`payload`: JSON
/// `{docKey}`), without minting one; `null` is genesis. Read before a
/// controlled write by a tab with no expected head.
///
/// # Errors
/// `INVALID_REQUEST` for a malformed payload or key, or the off refusal.
#[tauri::command]
pub async fn agent_journal_head<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, Option<RevisionId>>, CommandError> {
    bind_call(&call_id, on_state(app, move |s| s.head(&payload))).await
}
