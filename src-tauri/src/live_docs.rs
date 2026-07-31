//! # Live Document References (WI-9)
//!
//! Purpose: let one window ask every OTHER document window for the image
//! references held in its live buffers. Zustand state is per-webview, so
//! window A closing a document cannot see that window B's unsaved buffer is
//! the sole reference to an image — and deleted it. This module is the
//! cross-window bridge that closes that gap.
//!
//! Pipeline: requester invokes `collect_live_document_refs` → Rust emits
//! `live-docs:request {requestId}` to every other document window → each
//! window's responder invokes `live_docs_response` with its reference keys →
//! Rust unions them and resolves, or times out.
//!
//! Key decisions:
//!   - FAIL CLOSED. `complete` is true only when every targeted window
//!     answered inside the deadline. The caller treats an incomplete result
//!     as "cannot verify" and deletes nothing — a hung window must never
//!     cause another window's image to be trashed.
//!   - The payload is extracted REFERENCE KEYS, not document contents: the
//!     parsing happens in the window that owns the buffer, and the IPC stays
//!     small no matter how large the documents are.
//!   - 800 ms deadline. A responder does no IO — it reads its own store and
//!     extracts references — so a healthy window answers in milliseconds;
//!     the deadline only bounds a wedged or busy one.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::quit::is_document_window_label;

/// How long the requester waits for every window to answer.
const COLLECT_DEADLINE_MS: u64 = 800;

/// What the frontend gets back.
#[derive(serde::Serialize)]
pub struct LiveDocRefs {
    /// True only when every targeted window answered.
    pub complete: bool,
    /// Union of every responder's reference keys.
    pub refs: Vec<String>,
}

/// One in-flight collection.
struct Pending {
    remaining: usize,
    refs: Vec<String>,
    done: Option<oneshot::Sender<()>>,
}

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Record one window's answer. Returns true when the request is now complete.
/// Pure with respect to windows — unit-testable without an AppHandle.
fn apply_response(request_id: &str, mut refs: Vec<String>) -> bool {
    let mut pending = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    let Some(entry) = pending.get_mut(request_id) else {
        // Late answer after the deadline — the requester has moved on.
        return false;
    };
    entry.refs.append(&mut refs);
    entry.remaining = entry.remaining.saturating_sub(1);
    if entry.remaining == 0 {
        if let Some(done) = entry.done.take() {
            let _ = done.send(());
        }
        return true;
    }
    false
}

/// Take the finished (or timed-out) request's state out of the table.
fn take_result(request_id: &str) -> (bool, Vec<String>) {
    let mut pending = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    match pending.remove(request_id) {
        Some(entry) => (entry.remaining == 0, entry.refs),
        None => (false, Vec::new()),
    }
}

/// Register a request expecting `expected` answers. Returns the completion
/// receiver. Zero expected answers is complete immediately.
fn register_request(request_id: &str, expected: usize) -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    let mut pending = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    let mut entry = Pending {
        remaining: expected,
        refs: Vec::new(),
        done: Some(tx),
    };
    if expected == 0 {
        if let Some(done) = entry.done.take() {
            let _ = done.send(());
        }
    }
    pending.insert(request_id.to_string(), entry);
    rx
}

/// Ask every OTHER document window for its live image-reference keys.
#[tauri::command]
pub async fn collect_live_document_refs(
    app: AppHandle,
    requesting_label: String,
) -> Result<LiveDocRefs, String> {
    let targets: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| is_document_window_label(label) && **label != requesting_label)
        .cloned()
        .collect();

    let request_id = uuid::Uuid::new_v4().to_string();
    let rx = register_request(&request_id, targets.len());

    for label in &targets {
        if let Some(window) = app.webview_windows().get(label).cloned() {
            // An emit failure counts as that window not answering — the
            // deadline then reports the collection incomplete (fail closed).
            let _ = window.emit("live-docs:request", &request_id);
        }
    }

    let _ = tokio::time::timeout(std::time::Duration::from_millis(COLLECT_DEADLINE_MS), rx).await;

    let (complete, refs) = take_result(&request_id);
    Ok(LiveDocRefs { complete, refs })
}

/// A window's answer to `live-docs:request`.
#[tauri::command]
pub async fn live_docs_response(request_id: String, refs: Vec<String>) -> Result<(), String> {
    apply_response(&request_id, refs);
    Ok(())
}

#[cfg(test)]
#[path = "live_docs.test.rs"]
mod tests;
