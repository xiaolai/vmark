//! Ledger entry envelope and typed-body dispatch (pure — ADR-C4).
//! Split from `types.rs` for the file-size gate; `types.rs` re-exports
//! everything here, so consumers import from `types` unchanged.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::types::{
    Diagnostic, Navigation, ObjectRegistered, Resolution, Transformation, WriterId, FORMAT_VERSION,
};

/// Spec §5.3 — the wire envelope. `body` stays raw so unknown kinds are
/// preserved byte-faithfully; `typed()` dispatches known kinds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    pub format: u32,
    pub id: Uuid,
    pub kind: String,
    pub time: String,
    pub writer: WriterId,
    pub idem: Uuid,
    pub body: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypedBody {
    Transformation(Transformation),
    Navigation(Navigation),
    Ratification(Resolution),
    Waiver(Resolution),
    ObjectRegistered(ObjectRegistered),
    Diagnostic(Diagnostic),
    /// Known-by-spec, consumed from Phase 2b on; preserved untouched here.
    Preserved {
        kind: String,
        body: serde_json::Value,
    },
    /// Forward compatibility: unknown kinds are preserved and ignored.
    Unknown {
        kind: String,
        body: serde_json::Value,
    },
}

impl Envelope {
    /// Deterministic reader order: (parsed RFC 3339 time, entry id).
    /// `None` for unparseable times — callers treat that as malformed.
    pub fn sort_key(&self) -> Option<(chrono::DateTime<chrono::FixedOffset>, Uuid)> {
        chrono::DateTime::parse_from_rfc3339(&self.time)
            .ok()
            .map(|t| (t, self.id))
    }

    /// Mint a new entry: fresh UUIDv7 `id` and `idem` (the idem is created
    /// once per logical operation and reused verbatim on any retry —
    /// spec §5.1), current UTC time.
    pub fn create(kind: &str, writer: WriterId, body: serde_json::Value) -> Self {
        Self {
            format: FORMAT_VERSION,
            id: Uuid::now_v7(),
            kind: kind.to_string(),
            time: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            writer,
            idem: Uuid::now_v7(),
            body,
        }
    }

    #[cfg(test)]
    pub fn new_test(kind: &str, body: serde_json::Value) -> Self {
        Self::create(kind, WriterId(Uuid::now_v7()), body)
    }
}

#[cfg(test)]
#[path = "envelope.test.rs"]
mod tests;
