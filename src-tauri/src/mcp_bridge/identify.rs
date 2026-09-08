//! The `identify` envelope: the label a client asks to be known by.
//!
//! **Informational only.** It sets the name shown in Settings → Integrations
//! and in connect/disconnect logs, and it deliberately does not touch
//! `ClientConnection::principal`: a client may send `identify` at any time and
//! as often as it likes, and it used to be able to name itself into another
//! client's delegations that way (audit 20260728 §2.1).
//!
//! Split out of `server.rs` (#376/#381), and tightened on the way (#375):
//!
//!   - a payload that does not parse is LOGGED, not discarded in silence — it
//!     is a client speaking a protocol this build does not, and the only way
//!     anyone finds out is the log;
//!   - the name and version are bounded and stripped of control characters
//!     before they are stored, because they are rendered in Settings and
//!     written to the log (`peer_text.rs` is the rule);
//!   - a name that is empty once sanitized is refused: it names nothing, and
//!     storing it would blank the client's row;
//!   - `clients-changed` is emitted only after the stored identity actually
//!     CHANGED. It used to fire for an identify naming an unknown client id,
//!     and again for every repeat of an identity already stored — the frontend
//!     re-reads the whole client list on each one.
//!
//! @coordinates-with mcp_bridge/server.rs — the envelope dispatcher
//! @coordinates-with mcp_bridge/peer_text.rs — the bound and the escaping
//! @module mcp_bridge::identify

use tauri::AppHandle;
use tauri::Emitter;

use super::managed::bridge;
use super::peer_text::{peer_label, peer_text};
use super::types::ClientIdentity;

/// The event the frontend re-reads its client list on.
const CLIENTS_CHANGED: &str = "mcp-bridge:clients-changed";

/// Handle the `identify` message a client sends after connecting.
pub(super) async fn handle_identify<R: tauri::Runtime>(
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
    let Some(identity) = sanitize(identity) else {
        log::warn!("[MCP Bridge] Client {client_id} sent an identify with no usable name");
        return;
    };

    let changed = store(app, client_id, identity).await;
    if changed {
        let _ = app.emit(CLIENTS_CHANGED, ());
    }
}

/// Bound and strip the client-supplied fields; `None` when nothing usable is
/// left of the name.
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
    let shown = identity.display_name();
    if client.identity.as_ref().map(ClientIdentity::display_name) == Some(shown.clone()) {
        return false;
    }
    log::debug!(
        "[MCP Bridge] Client {client_id} identified as {}",
        peer_text(&shown)
    );
    client.identity = Some(identity);
    true
}

#[cfg(test)]
#[path = "identify.test.rs"]
mod tests;
