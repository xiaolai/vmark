//! The closed browser-operation vocabulary (R4/R5).
//!
//! Mirrors `BROWSER_OPERATIONS` / `NEVER_AUTOMATED` in
//! `lib/browser/approval/grants.ts`. Kept separate from origin canonicalization:
//! an operation is an authorization *token*, orthogonal to which origin it runs
//! against. Anything outside this closed set is rejected rather than treated as an
//! opaque permission — that is how a hard denial or an operation-scoped grant
//! cannot be bypassed by a misspelled or case-variant spelling (`"Upload"`).
//!
//! @coordinates-with src/lib/browser/approval/grants.ts — the mirrored vocabulary

/// Operations the AI may NEVER perform autonomously, even with a matching grant.
/// An AI-chosen file upload is an exfiltration path, so upload targets stay
/// human-chosen (mirrors `NEVER_AUTOMATED` in the TS layer).
pub(crate) const NEVER_AUTOMATED: &[&str] = &["upload"];

/// The closed browser-operation vocabulary. The `Deserialize` impl is the
/// enforceable form: it rejects unknown/variant spellings at the wire boundary.
/// `from_wire` is the single source of truth — both the deserializer and
/// `is_known_operation` delegate to it, so the set has exactly one definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserOperation {
    Read,
    Attach,
    Click,
    Type,
    Scroll,
    Key,
    Navigate,
    Publish,
    Upload,
}

impl BrowserOperation {
    /// Parse a wire operation string, or `None` for unknown/variant spellings.
    fn from_wire(s: &str) -> Option<Self> {
        match s {
            "read" => Some(Self::Read),
            "attach" => Some(Self::Attach),
            "click" => Some(Self::Click),
            "type" => Some(Self::Type),
            "scroll" => Some(Self::Scroll),
            "key" => Some(Self::Key),
            "navigate" => Some(Self::Navigate),
            "publish" => Some(Self::Publish),
            "upload" => Some(Self::Upload),
            _ => None,
        }
    }
}

impl<'de> serde::Deserialize<'de> for BrowserOperation {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Self::from_wire(&s)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown browser operation: {s:?}")))
    }
}

/// Is `operation` a known browser operation? Misspellings and case variants
/// (`"Upload"`, `"read "`) are NOT — mirrors `isBrowserOperation` in the TS layer.
pub fn is_known_operation(operation: &str) -> bool {
    BrowserOperation::from_wire(operation).is_some()
}

#[cfg(test)]
#[path = "operation.test.rs"]
mod tests;
