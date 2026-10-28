//! The `identify` envelope: the label a client asks to be known by.
//!
//! **Informational only.** It sets the name shown in Settings → Integrations
//! and in connect/disconnect logs, and it deliberately does not touch
//! `ClientConnection::principal`: a client may send `identify` at any time and
//! as often as it likes, and it used to be able to name itself into another
//! client's delegations that way.
//!
//! Split out of `server.rs`, and tightened on the way:
//!
//!   - a payload that does not parse is LOGGED, not discarded in silence — it
//!     is a client speaking a protocol this build does not, and the only way
//!     anyone finds out is the log;
//!   - the name and version are bounded and stripped of control characters
//!     before they are stored, because they are rendered in Settings and
//!     written to the log (`peer_text.rs` is the rule);
//!   - a name that is empty once sanitized is refused: it names nothing, and
//!     storing it would blank the client's row;
//!   - an optional `sessionLabel` names the client's current session for
//!     grouping its edits. It is validated, not sanitized: one over the byte
//!     limit or holding control characters refuses the WHOLE identify with a
//!     structured error reply, and the stored identity is left as it was
//!     (`attribution.rs` is the rule);
//!   - `clients-changed` is emitted only after the stored identity actually
//!     CHANGED. It used to fire for an identify naming an unknown client id,
//!     and again for every repeat of an identity already stored — the frontend
//!     re-reads the whole client list on each one.
//!
//! @coordinates-with mcp_bridge/server.rs — the envelope dispatcher
//! @coordinates-with peer_text.rs — the bound and the escaping
//! @coordinates-with mcp_bridge/attribution.rs — the session-label rule
//! @module mcp_bridge::identify

use tauri::AppHandle;
use tauri::Emitter;

use super::attribution::validate_session_label;
use super::delivery::send_error_response;
use super::managed::bridge;
use super::server::client_sender;
use super::types::ClientIdentity;
use crate::peer_text::{peer_label, peer_text};

/// The event the frontend re-reads its client list on.
const CLIENTS_CHANGED: &str = "mcp-bridge:clients-changed";

/// Handle the `identify` message a client sends after connecting.
///
/// `msg_id` is the envelope id, used only to correlate a refusal reply.
pub(super) async fn handle_identify<R: tauri::Runtime>(
    msg_id: &str,
    payload: serde_json::Value,
    client_id: u64,
    app: &AppHandle<R>,
) {
    let identity = match serde_json::from_value::<ClientIdentity>(payload) {
        Ok(identity) => identity,
        Err(e) => {
            log::warn!("[MCP Bridge] Client {client_id} sent an identify it could not parse: {e}");
            return;
        }
    };
    let session_label = match validate_session_label(identity.session_label.as_deref()) {
        Ok(label) => label,
        Err(refusal) => {
            log::warn!("[MCP Bridge] Client {client_id} identify refused: {refusal}");
            refuse(app, client_id, msg_id, &refusal).await;
            return;
        }
    };
    let Some(identity) = sanitize(ClientIdentity {
        session_label,
        ..identity
    }) else {
        log::warn!("[MCP Bridge] Client {client_id} sent an identify with no usable name");
        return;
    };

    let changed = store(app, client_id, identity).await;
    if changed {
        let _ = app.emit(CLIENTS_CHANGED, ());
    }
}

/// Answer a refused identify on the client's own channel. Before session
/// labels an identify was never answered; a refusal must be, or the client
/// cannot learn its label was not applied.
async fn refuse<R: tauri::Runtime>(app: &AppHandle<R>, client_id: u64, msg_id: &str, error: &str) {
    let bridge = bridge(app);
    // One lookup for every envelope handler (`server::client_sender`); an
    // identify whose client has gone is dropped, as other envelopes are.
    if let Some(tx) = client_sender(bridge, client_id).await {
        send_error_response(bridge, client_id, &tx, msg_id, error).await;
    }
}

/// Bound and strip the client-supplied name and version; `None` when nothing
/// usable is left of the name. The session label passes through unchanged —
/// it was validated, not sanitized, before this.
fn sanitize(identity: ClientIdentity) -> Option<ClientIdentity> {
    let name = peer_label(&identity.name);
    if name.trim().is_empty() {
        return None;
    }
    Some(ClientIdentity {
        name,
        version: identity
            .version
            .as_deref()
            .map(peer_label)
            .filter(|v| !v.trim().is_empty()),
        session_label: identity.session_label,
    })
}

/// Store `identity` against a CONNECTED client, returning whether it changed
/// what was there. An id with no live connection changes nothing.
async fn store<R: tauri::Runtime>(
    app: &AppHandle<R>,
    client_id: u64,
    identity: ClientIdentity,
) -> bool {
    let mut guard = bridge(app).lock().await;
    let Some(client) = guard.clients.get_mut(&client_id) else {
        log::debug!("[MCP Bridge] identify for client {client_id}, which is not connected");
        return false;
    };
    if client.identity.as_ref() == Some(&identity) {
        return false;
    }
    log::debug!(
        "[MCP Bridge] Client {client_id} identified as {}",
        peer_text(&identity.display_name())
    );
    client.identity = Some(identity);
    true
}

#[cfg(test)]
#[path = "identify.test.rs"]
mod tests;

// Mock-runtime tests: `tauri::test` does not exist on Windows.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "identify_attribution.test.rs"]
mod attribution_tests;
