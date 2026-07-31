//! # Live Document References (WI-9)
//!
//! Purpose: let one window ask every OTHER document window for the image
//! references held in its live buffers. Zustand state is per-webview, so
//! window A closing a document cannot see that window B's unsaved buffer is
//! the sole reference to an image — and deleted it. This module is the
//! cross-window bridge that closes that gap.
//!
//! Pipeline: requester invokes `collect_live_document_refs` → Rust emit_to's
//! `live-docs:request {requestId}` to each other document window → each
//! window's responder invokes `live_docs_response` with its LABEL and its
//! reference keys → Rust checks the label off the expected set, unions the
//! keys, and resolves when the set empties — or times out.
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

/// One in-flight collection. Answers are counted by DISTINCT window label
/// against the expected set — `window.emit` is a BROADCAST in Tauri v2, so
/// without labels the requester's own responder (or a Strict-Mode duplicate
/// listener) could complete the count while the window that mattered never
/// answered, reporting `complete` on missing evidence.
struct Pending {
    expected: std::collections::HashSet<String>,
    refs: Vec<String>,
    done: Option<oneshot::Sender<()>>,
}

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Record one window's answer. Returns true when the request is now complete.
/// Pure with respect to windows — unit-testable without an AppHandle.
///
/// Only labels in the EXPECTED set count, each once: the requester's own
/// answer (broadcast echo) and duplicate answers (Strict-Mode double
/// listeners) are recorded refs at most, never progress.
fn apply_response(request_id: &str, label: &str, mut refs: Vec<String>) -> bool {
    let mut pending = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    let Some(entry) = pending.get_mut(request_id) else {
        // Late answer after the deadline — the requester has moved on.
        return false;
    };
    if !entry.expected.remove(label) {
        // Not a window we are waiting for (requester echo, duplicate, stray).
        return false;
    }
    entry.refs.append(&mut refs);
    if entry.expected.is_empty() {
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
        Some(entry) => (entry.expected.is_empty(), entry.refs),
        None => (false, Vec::new()),
    }
}

/// Register a request expecting an answer from each label in `expected`.
/// Returns the completion receiver. Zero expected labels is complete
/// immediately.
fn register_request(
    request_id: &str,
    expected: std::collections::HashSet<String>,
) -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    let mut pending = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    let mut entry = Pending {
        expected,
        refs: Vec::new(),
        done: Some(tx),
    };
    if entry.expected.is_empty() {
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
    let targets: std::collections::HashSet<String> = app
        .webview_windows()
        .keys()
        .filter(|label| is_document_window_label(label) && **label != requesting_label)
        .cloned()
        .collect();

    let request_id = uuid::Uuid::new_v4().to_string();
    let rx = register_request(&request_id, targets.clone());

    for label in &targets {
        // emit_to targets ONE window — window.emit broadcasts in Tauri v2,
        // which let the requester answer its own request. The expected-label
        // set in apply_response is the second line of defence. An emit failure
        // counts as that window not answering — the deadline then reports the
        // collection incomplete (fail closed).
        let _ = app.emit_to(label.as_str(), "live-docs:request", &request_id);
    }

    let _ = tokio::time::timeout(std::time::Duration::from_millis(COLLECT_DEADLINE_MS), rx).await;

    let (complete, refs) = take_result(&request_id);
    Ok(LiveDocRefs { complete, refs })
}

/// A window's answer to `live-docs:request`.
#[tauri::command]
pub async fn live_docs_response(
    request_id: String,
    label: String,
    refs: Vec<String>,
) -> Result<(), String> {
    apply_response(&request_id, &label, refs);
    Ok(())
}

#[cfg(test)]
#[path = "live_docs.test.rs"]
mod tests;
