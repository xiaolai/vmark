//! Field-level validation for envelope bodies: edge coordinates and bounded
//! strings.
//!
//! Split out of `envelope.rs` for size. These are the checks applied to UNTRUSTED
//! ledger content — another tool can append to the ledger — so keeping them in
//! one small readable file is the point.
//!
//! @coordinates-with envelope.rs — the module this was split from
//! @module coherence/envelope_validate

use uuid::Uuid;

/// Validate an `edge` coordinate as a real `(Uuid, u32)` pair.
pub(super) fn edge_coords(b: &serde_json::Value, kind: &str) -> Result<(Uuid, u32), String> {
    let edge = b
        .get("edge")
        .ok_or_else(|| format!("{kind} missing edge"))?;
    let txf = edge
        .get("txf")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| format!("{kind} edge.txf is not a uuid"))?;
    let input = edge
        .get("input")
        .and_then(|v| v.as_u64())
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| format!("{kind} edge.input is not a u32"))?;
    Ok((txf, input))
}

/// Bound an optional free-text field.
pub(super) fn bounded_str(
    b: &serde_json::Value,
    key: &str,
    max: usize,
    kind: &str,
) -> Result<(), String> {
    match b.get(key).and_then(|v| v.as_str()) {
        Some(s) if s.len() > max => Err(format!("{kind} {key} is over the {max}-byte cap")),
        _ => Ok(()),
    }
}
