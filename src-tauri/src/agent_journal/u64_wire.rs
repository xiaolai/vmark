//! `u64` counters (`reviewGen`, journal generation) on the wire and in the
//! journal: a canonical decimal string, never a JSON number — a
//! JavaScript number loses precision above 2^53. Pinned by `src/test/fixtures/agentJournal/u64.json`.
//!
//! Accepted: `^(0|[1-9][0-9]*)$` and ≤ u64::MAX. Refused: numbers, signs,
//! leading zeros, whitespace, exponents, non-ASCII digits, overflow.
//! Use as `#[serde(with = "crate::agent_journal::u64_wire")]`.

use serde::{de::Error as _, Deserialize, Deserializer, Serializer};

/// Parse a canonical decimal; `None` for anything else.
pub fn parse(s: &str) -> Option<u64> {
    let canonical = s == "0"
        || (s
            .as_bytes()
            .first()
            .is_some_and(|b| (b'1'..=b'9').contains(b))
            && s.bytes().all(|b| b.is_ascii_digit()));
    if canonical {
        s.parse().ok()
    } else {
        None
    }
}

pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
    s.collect_str(v)
}

pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let s = String::deserialize(d)?;
    parse(&s).ok_or_else(|| D::Error::custom(format!("not a canonical u64 decimal string: {s:?}")))
}
