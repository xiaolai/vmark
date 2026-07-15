//! # Tab Removal Handshake
//!
//! Purpose: the wire contract + pending-request registry behind
//! `tab_transfer::remove_tab_from_window`, which takes a tab back out of the
//! window it was moved to (the Undo on a tab move).
//!
//! Undo cannot replay the source's pre-transfer snapshot: the user may have
//! typed in the destination window since the move, and writing the snapshot back
//! would silently destroy those edits. So removal is a two-phase round trip:
//!
//!   1. `prepare` — the destination reports the tab's CURRENT state. Nothing is
//!      removed. The source restores from this ack.
//!   2. `commit`  — only now does the destination drop its copy.
//!
//! Every failure mode (window gone, no answer, refusal) leaves the destination's
//! tab intact and fails the undo. A failed undo is recoverable; a destroyed
//! document is not.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::TabTransferData;

/// `prepare`: report the tab's live state; remove nothing.
pub(crate) const REMOVAL_PHASE_PREPARE: &str = "prepare";
/// `commit`: remove the tab. Only sent once the source holds the restored copy.
pub(crate) const REMOVAL_PHASE_COMMIT: &str = "commit";

pub(crate) const REMOVE_EVENT: &str = "tab:remove-by-id";
pub(crate) const REMOVE_ACK_EVENT: &str = "tab:remove-ack";

/// A destination that hasn't answered in this long is treated as unreachable —
/// the undo fails and its tab is left alone.
pub(crate) const REMOVAL_ACK_TIMEOUT_MS: u64 = 5_000;

/// Request sent to the destination window for one phase of the handshake.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TabRemovalRequest {
    pub request_id: String,
    pub tab_id: String,
    pub phase: String,
}

/// The destination window's answer.
///
/// On an accepted `prepare`, `data` carries the tab's state **as it exists in
/// the destination right now**, including edits made after the transfer. Undo
/// restores from this — that is the entire point of the round trip.
///
/// `accepted: false` is a refusal: the destination still has the tab, and the
/// caller must not act as though it is gone.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRemovalAck {
    pub request_id: String,
    pub tab_id: String,
    pub phase: String,
    pub accepted: bool,
    pub reason: Option<String>,
    pub data: Option<TabTransferData>,
}

/// Requests waiting for their destination window to answer, keyed by request id.
static PENDING_ACKS: Mutex<Option<HashMap<String, oneshot::Sender<TabRemovalAck>>>> =
    Mutex::new(None);

type PendingGuard =
    std::sync::MutexGuard<'static, Option<HashMap<String, oneshot::Sender<TabRemovalAck>>>>;

pub(crate) fn pending_acks() -> PendingGuard {
    PENDING_ACKS.lock().unwrap_or_else(|p| p.into_inner())
}

/// Reject any phase we don't know: the only other thing this protocol does is
/// destroy a tab, so an unrecognized phase must never fall through to it.
pub(crate) fn validate_phase(phase: &str) -> Result<(), String> {
    if phase == REMOVAL_PHASE_PREPARE || phase == REMOVAL_PHASE_COMMIT {
        return Ok(());
    }
    Err(format!("Unknown tab-removal phase '{}'", phase))
}

pub(crate) fn register_pending_ack(request_id: &str) -> oneshot::Receiver<TabRemovalAck> {
    let (tx, rx) = oneshot::channel();
    pending_acks()
        .get_or_insert_with(HashMap::new)
        .insert(request_id.to_string(), tx);
    rx
}

pub(crate) fn drop_pending_ack(request_id: &str) {
    if let Some(map) = pending_acks().as_mut() {
        map.remove(request_id);
    }
}

/// Deliver an ack to the request waiting on it. An ack for an unknown request
/// (stale, duplicate, or misdirected) is a silent no-op — it must not disturb
/// any other pending request.
pub(crate) fn route_ack(ack: TabRemovalAck) {
    let sender = pending_acks()
        .as_mut()
        .and_then(|map| map.remove(&ack.request_id));
    if let Some(sender) = sender {
        let _ = sender.send(ack);
    }
}
