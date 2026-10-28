//! Actor model.
//!
//! `actor` is a closed union. `mcp` keeps the four Rust `BridgePrincipal`
//! states distinct (never collapsed to "unknown"), carries the per-connection
//! UUID, and keeps the untrusted, client-declared strings (`sessionLabel`,
//! `displayName`) apart from the credential-derived principal. A record stores
//! the content author (`actor`) and the persistence initiator (`initiator`)
//! separately, because an agent's `workspace.save` can persist human edits.

use serde::{Deserialize, Serialize};

use crate::agent_journal::ids::ConnectionId;
use crate::peer_text::is_bidi_formatting;

/// `sessionLabel` is at most 128 UTF-8 bytes.
pub const SESSION_LABEL_MAX_BYTES: usize = 128;

/// Who made a change. Decoded through [`ActorWire`], so an unknown key is
/// refused on every variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    from = "ActorWire"
)]
pub enum Actor {
    /// A person at the keyboard.
    Human,
    /// An MCP client.
    Mcp {
        principal: Principal,
        connection_id: ConnectionId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_label: Option<String>,
        /// Untrusted display name declared by the client.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_name: Option<String>,
    },
    /// VMark itself (retention, migration, recovery).
    System { reason: String },
    /// Pre-journal entries; attribution unknown.
    Legacy,
}

/// The four `BridgePrincipal` states, credential-derived in Rust. Decoded
/// through [`PrincipalWire`], so an unknown key is refused on every variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    from = "PrincipalWire"
)]
pub enum Principal {
    Anonymous,
    Unrecognized,
    Ambiguous,
    Provider { provider: String },
}

/// `Actor` as read. `deny_unknown_fields` cannot see keys beside the tag of
/// a unit variant, so `human` and `legacy` decode as empty struct variants
/// here; the written shape (`{"type":"human"}`) is unchanged.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ActorWire {
    Human {},
    Mcp {
        principal: Principal,
        connection_id: ConnectionId,
        #[serde(default)]
        session_label: Option<String>,
        #[serde(default)]
        display_name: Option<String>,
    },
    System {
        reason: String,
    },
    Legacy {},
}

impl From<ActorWire> for Actor {
    fn from(w: ActorWire) -> Self {
        match w {
            ActorWire::Human {} => Self::Human,
            ActorWire::Mcp {
                principal,
                connection_id,
                session_label,
                display_name,
            } => Self::Mcp {
                principal,
                connection_id,
                session_label,
                display_name,
            },
            ActorWire::System { reason } => Self::System { reason },
            ActorWire::Legacy {} => Self::Legacy,
        }
    }
}

/// `Principal` as read; see [`ActorWire`] for why unit variants are empty
/// structs here.
#[derive(Deserialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum PrincipalWire {
    Anonymous {},
    Unrecognized {},
    Ambiguous {},
    Provider { provider: String },
}

impl From<PrincipalWire> for Principal {
    fn from(w: PrincipalWire) -> Self {
        match w {
            PrincipalWire::Anonymous {} => Self::Anonymous,
            PrincipalWire::Unrecognized {} => Self::Unrecognized,
            PrincipalWire::Ambiguous {} => Self::Ambiguous,
            PrincipalWire::Provider { provider } => Self::Provider { provider },
        }
    }
}

impl Actor {
    /// Enforce the bridge's canonical `sessionLabel` rule: at most 128 bytes
    /// (a refusal, never a truncation), nonblank (the bridge maps a blank
    /// label to `None`), and free of control and bidirectional formatting
    /// characters. Run on every write request; a record replayed from disk
    /// is not re-validated.
    pub fn validate(&self) -> Result<(), String> {
        if let Actor::Mcp {
            session_label: Some(label),
            ..
        } = self
        {
            if label.len() > SESSION_LABEL_MAX_BYTES {
                return Err(format!(
                    "sessionLabel is {} UTF-8 bytes; the limit is {SESSION_LABEL_MAX_BYTES}",
                    label.len()
                ));
            }
            if label.trim().is_empty() {
                return Err("sessionLabel must not be blank; omit it instead".to_string());
            }
            if label
                .chars()
                .any(|c| c.is_control() || is_bidi_formatting(c))
            {
                return Err(
                    "sessionLabel must not contain control or bidirectional formatting characters"
                        .to_string(),
                );
            }
        }
        Ok(())
    }
}
