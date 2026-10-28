//! Canonical hunk id, shared byte-for-byte with the TypeScript worker
//! and pinned by `src/test/fixtures/agentJournal/hunkIds.json`.
//!
//! - `textHash` = lowercase hex SHA-256 of the text's UTF-8 bytes (no prefix).
//! - preimage = the compact JSON array `[baseRev, targetRev, baseRange.from,
//!   baseRange.to, targetRange.from, targetRange.to, baseTextHash,
//!   targetTextHash]` — serde_json's escaping equals `JSON.stringify` for
//!   well-formed strings, and the array framing keeps fields unambiguous.
//! - id = lowercase hex SHA-256 of the preimage's UTF-8 bytes.
//!
//! Ranges are UTF-16 code units, `0 ≤ from ≤ to ≤ 2^53−1` (a JavaScript safe
//! integer). A missing base (the first revision has no parent revision) is
//! JSON `null`; the TS side always names a base, so it never produces one.

use serde::{Deserialize, Serialize};

use crate::agent_journal::ids::{is_sha256_hex, sha256_hex};

/// Largest offset both sides represent exactly (`Number.MAX_SAFE_INTEGER`).
pub const MAX_OFFSET: u64 = (1 << 53) - 1;

/// A range as the id hashes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdRange {
    pub from: u64,
    pub to: u64,
}

/// Everything a hunk id hashes. Deserializes from the TS `HunkIdInput`
/// shape; `baseRev` must be present (it may be `null`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkIdInput {
    #[serde(deserialize_with = "Option::deserialize")]
    pub base_rev: Option<String>,
    pub target_rev: String,
    pub base_range: IdRange,
    pub target_range: IdRange,
    pub base_text_hash: String,
    pub target_text_hash: String,
}

/// Lowercase hex SHA-256 of the text's UTF-8 bytes.
pub fn text_hash(text: &str) -> String {
    sha256_hex(text.as_bytes())
}

fn check_range(name: &str, r: IdRange) -> Result<(), String> {
    if r.from <= r.to && r.to <= MAX_OFFSET {
        Ok(())
    } else {
        Err(format!("{name} must satisfy 0 ≤ from ≤ to ≤ 2^53−1"))
    }
}

fn check_hash(name: &str, h: &str) -> Result<(), String> {
    if is_sha256_hex(h) {
        Ok(())
    } else {
        Err(format!("{name} must be 64 lowercase hex digits"))
    }
}

/// The exact string hashed into the id. Fails loud on a malformed field.
pub fn canonical_preimage(h: &HunkIdInput) -> Result<String, String> {
    check_range("baseRange", h.base_range)?;
    check_range("targetRange", h.target_range)?;
    check_hash("baseTextHash", &h.base_text_hash)?;
    check_hash("targetTextHash", &h.target_text_hash)?;
    let tuple = (
        &h.base_rev,
        &h.target_rev,
        h.base_range.from,
        h.base_range.to,
        h.target_range.from,
        h.target_range.to,
        &h.base_text_hash,
        &h.target_text_hash,
    );
    serde_json::to_string(&tuple).map_err(|e| e.to_string())
}

/// The canonical hunk id: lowercase hex SHA-256 of the preimage.
pub fn hunk_id(h: &HunkIdInput) -> Result<String, String> {
    canonical_preimage(h).map(|p| text_hash(&p))
}
