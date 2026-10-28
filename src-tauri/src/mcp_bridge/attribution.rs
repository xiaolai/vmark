//! Who sent a routed request, as it crosses into the webview.
//!
//! Every `McpRequestEvent` carries an [`McpAttribution`]: the credential-derived
//! principal, the id of the authenticated connection, and — kept apart from
//! both — the two things the client merely SAYS about itself (its display name
//! and an optional session label from `identify`). The journal records the
//! first two as fact and the last two as untrusted labels for display and
//! grouping only.
//!
//! Key decisions:
//!   - The principal is a tagged union with one tag per `BridgePrincipal`
//!     state. The three ways a connection can fail to be identified have
//!     different causes, so none of them is collapsed into another or into an
//!     "unknown"; the match in `From<&BridgePrincipal>` is exhaustive, so a
//!     fifth state cannot ship without a wire tag.
//!   - The connection id is a random UUID minted when a connection
//!     authenticates — not the welcome-frame client id, which is a counter that
//!     restarts with the process and would make two sessions' records collide.
//!   - A session label over [`MAX_SESSION_LABEL_BYTES`] UTF-8 bytes, or one
//!     holding control characters, is REFUSED with a structured error. It is
//!     never truncated or stripped: a silently altered label would group
//!     records under a name the client never chose.
//!   - A client that is no longer connected has NO attribution. Requests are
//!     refused for it rather than sent with a default principal.
//!
//! @coordinates-with mcp_bridge/principal.rs — the four states mirrored here
//! @coordinates-with mcp_bridge/identify.rs — where the session label arrives
//! @coordinates-with mcp_bridge/routed_request.rs — the one emitter of the envelope
//! @coordinates-with src/services/mcpBridge/attribution.ts — the TypeScript twin
//! @module mcp_bridge::attribution

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::principal::BridgePrincipal;
use super::state::{try_register_pending_for, BridgeState};
use super::types::McpResponse;
use crate::peer_text::is_bidi_formatting;

/// Largest session label accepted, in UTF-8 bytes (not characters).
pub(crate) const MAX_SESSION_LABEL_BYTES: usize = 128;

/// The wire form of [`BridgePrincipal`], one tag per state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PrincipalWire {
    /// Shared bridge token, no per-client credential.
    Anonymous,
    /// A per-client credential no configured provider holds.
    Unrecognized,
    /// A credential two or more providers share; names all of them.
    Ambiguous { providers: Vec<String> },
    /// The credential VMark issued to exactly this provider.
    Provider { provider_id: String },
}

impl From<&BridgePrincipal> for PrincipalWire {
    fn from(principal: &BridgePrincipal) -> Self {
        match principal {
            BridgePrincipal::Anonymous => PrincipalWire::Anonymous,
            BridgePrincipal::Unrecognized => PrincipalWire::Unrecognized,
            BridgePrincipal::Ambiguous(providers) => PrincipalWire::Ambiguous {
                providers: providers.clone(),
            },
            BridgePrincipal::Provider(id) => PrincipalWire::Provider {
                provider_id: id.clone(),
            },
        }
    }
}

/// Who sent a request: proven fields first, client-asserted labels after.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpAttribution {
    /// Derived from the credential presented at authentication.
    pub principal: PrincipalWire,
    /// Minted by VMark when the connection authenticated (hyphenated UUID).
    pub connection_id: String,
    /// Client-declared at `identify`; untrusted, display and grouping only.
    pub session_label: Option<String>,
    /// Client-declared name and version; untrusted, display only.
    pub display_name: Option<String>,
}

/// A fresh id for one authenticated connection.
pub(crate) fn mint_connection_id() -> uuid::Uuid {
    uuid::Uuid::new_v4()
}

/// Accept a client-declared session label, or refuse it with a structured
/// `CODE: message` error. Absent and blank labels are "no label".
pub(crate) fn validate_session_label(label: Option<&str>) -> Result<Option<String>, String> {
    let Some(label) = label.filter(|l| !l.trim().is_empty()) else {
        return Ok(None);
    };
    if label.len() > MAX_SESSION_LABEL_BYTES {
        return Err(format!(
            "SESSION_LABEL_TOO_LONG: sessionLabel is {} UTF-8 bytes; the limit is {MAX_SESSION_LABEL_BYTES}",
            label.len()
        ));
    }
    if label
        .chars()
        .any(|c| c.is_control() || is_bidi_formatting(c))
    {
        return Err("SESSION_LABEL_INVALID: sessionLabel must not contain control or bidirectional formatting characters".to_string());
    }
    Ok(Some(label.to_string()))
}

/// The attribution of a CONNECTED client, or `None` when it is gone.
pub(crate) fn attribution_for(state: &BridgeState, client_id: u64) -> Option<McpAttribution> {
    let client = state.clients.get(&client_id)?;
    Some(McpAttribution {
        principal: PrincipalWire::from(&client.principal),
        connection_id: client.connection_id.hyphenated().to_string(),
        session_label: client
            .identity
            .as_ref()
            .and_then(|i| i.session_label.clone()),
        display_name: client.identity.as_ref().map(|i| i.display_name()),
    })
}

/// Read the client's attribution and register its pending request under ONE
/// state lock, so the request that is registered is the one that is
/// attributed. A gone client registers nothing.
pub(crate) fn register_attributed(
    state: &mut BridgeState,
    client_id: u64,
    request_id: String,
    response_tx: oneshot::Sender<McpResponse>,
) -> Result<McpAttribution, String> {
    let attribution = attribution_for(state, client_id).ok_or("Bridge stopped")?;
    try_register_pending_for(state, client_id, request_id, response_tx)?;
    Ok(attribution)
}

#[cfg(test)]
#[path = "attribution.test.rs"]
mod tests;
