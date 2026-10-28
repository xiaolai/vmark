//! Well-formed text at the JSON boundary, pure.
//!
//! The webview sends JavaScript strings, which may hold lone surrogates.
//! `JSON.stringify` writes those as `\uD800`-style escapes. serde_json then
//! refuses them with a generic parse error — and a lenient decoder would
//! substitute U+FFFD, so two different texts would share one hash. This
//! scanner names the failure: the payload must be valid UTF-8 and every
//! `\u` surrogate escape must be a high/low pair. Anything else is
//! `INVALID_TEXT`, before any record, blob or reservation exists.

use crate::agent_journal::errors::TxnError;

fn bad(detail: &str) -> TxnError {
    TxnError::InvalidText(detail.into())
}

/// A `\uXXXX` escape value, if the four digits are hex. Malformed escapes
/// are left to the JSON parser, which refuses them.
fn escape_unit(b: &[u8], i: usize) -> Option<u16> {
    let digits = std::str::from_utf8(b.get(i + 2..i + 6)?).ok()?;
    u16::from_str_radix(digits, 16).ok()
}

/// Refuse a payload whose strings are not well-formed Unicode.
pub fn check_json_text(payload: &[u8]) -> Result<(), TxnError> {
    let b = std::str::from_utf8(payload)
        .map_err(|e| bad(&format!("payload is not UTF-8: {e}")))?
        .as_bytes();
    let (mut i, mut in_str, mut high) = (0, false, false);
    while i < b.len() {
        let c = b[i];
        if !in_str {
            in_str = c == b'"';
            i += 1;
            continue;
        }
        let (unit, step) = match c {
            b'\\' if b.get(i + 1) == Some(&b'u') => (escape_unit(b, i), 6),
            b'\\' => (None, 2),
            _ => (None, 1),
        };
        match unit {
            Some(0xD800..=0xDBFF) if !high => high = true,
            Some(0xDC00..=0xDFFF) if high => high = false,
            Some(0xD800..=0xDFFF) => return Err(bad("lone surrogate escape")),
            _ if high => return Err(bad("lone high surrogate escape")),
            _ => in_str = c != b'"',
        }
        i += step;
    }
    if high {
        Err(bad("lone high surrogate escape"))
    } else {
        Ok(())
    }
}

/// Decode a JSON payload: well-formed text first (`INVALID_TEXT`), then
/// the shape (`INVALID_REQUEST`). Every text-bearing entry point decodes
/// through here, so there is one Unicode-validation path.
pub(crate) fn decode_json<T: serde::de::DeserializeOwned>(payload: &[u8]) -> Result<T, TxnError> {
    check_json_text(payload)?;
    serde_json::from_slice(payload).map_err(|e| TxnError::InvalidRequest(e.to_string()))
}

/// Read a nullable field that must be present: serde fills a missing
/// `Option` with `None`, which would let an absent key pass for `null`.
/// Use as `#[serde(deserialize_with = "…::wire::required")]`.
pub fn required<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(d)
}
