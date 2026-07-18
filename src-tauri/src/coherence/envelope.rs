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
    /// Dispatch the raw body by kind. `Err` means a malformed *known*
    /// kind (quarantine, spec §5.6); unknown kinds are `Ok(Unknown)`.
    pub fn typed(&self) -> Result<TypedBody, String> {
        if self.format > FORMAT_VERSION {
            return Err(format!("format {} is newer than this reader", self.format));
        }
        fn parse<T: serde::de::DeserializeOwned>(v: &serde_json::Value) -> Result<T, String> {
            serde_json::from_value(v.clone()).map_err(|e| e.to_string())
        }
        let b = &self.body;
        Ok(match self.kind.as_str() {
            "transformation" => {
                let t: Transformation = parse(b)?;
                if t.outputs.is_empty() {
                    return Err("transformation with no outputs".into());
                }
                TypedBody::Transformation(t)
            }
            "navigation" => TypedBody::Navigation(parse(b)?),
            "ratification" | "waiver" => {
                let r: Resolution = parse(b)?;
                // Spec §5.4.3 rev 2 (D2.4): a non-human resolution MUST
                // reference the grant that authorized it.
                let is_human = b
                    .get("actor")
                    .and_then(|a| a.get("type"))
                    .and_then(|v| v.as_str())
                    == Some("human");
                if !is_human && b.get("delegation").and_then(|v| v.as_str()).is_none() {
                    return Err("non-human resolution without a delegation reference".into());
                }
                if self.kind == "ratification" {
                    TypedBody::Ratification(r)
                } else {
                    TypedBody::Waiver(r)
                }
            }
            "object-registered" => TypedBody::ObjectRegistered(parse(b)?),
            // Spec §5.4.7 rev 2: delegation is a known, validated kind.
            "delegation" => {
                for key in ["delegation", "expires"] {
                    if b.get(key).and_then(|v| v.as_str()).is_none() {
                        return Err(format!("delegation missing {key}"));
                    }
                }
                if b.get("delegate")
                    .and_then(|d| d.get("id"))
                    .and_then(|v| v.as_str())
                    .is_none()
                {
                    return Err("delegation missing delegate.id".into());
                }
                if !b.get("scope").map(|s| s.is_array()).unwrap_or(false) {
                    return Err("delegation scope must be an array".into());
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "diagnostic" => TypedBody::Diagnostic(parse(b)?),
            // Known Phase-2b kinds: preserved, but schema-VALIDATED now so
            // malformed records quarantine instead of festering (§5.6).
            "check-result" => {
                let edge = b.get("edge").ok_or("check-result missing edge")?;
                if !edge.is_object() || edge.get("txf").and_then(|v| v.as_str()).is_none() {
                    return Err("check-result edge malformed".into());
                }
                for key in ["pinned", "checked_against"] {
                    let ok = b
                        .get(key)
                        .and_then(|v| v.as_str())
                        .is_some_and(|v| super::types::RevisionId::parse(v).is_ok());
                    if !ok {
                        return Err(format!("check-result {key} is not a revision id"));
                    }
                }
                let verdict = b
                    .get("verdict")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !["no-contradiction", "contradiction", "unknown"].contains(&verdict) {
                    return Err(format!("check-result verdict invalid: {verdict:?}"));
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "claim" => {
                if b.get("claim").and_then(|v| v.as_str()).is_none()
                    || b.get("statement").and_then(|v| v.as_str()).is_none()
                {
                    return Err("claim requires string claim + statement".into());
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            _ => TypedBody::Unknown {
                kind: self.kind.clone(),
                body: b.clone(),
            },
        })
    }

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
