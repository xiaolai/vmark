//! Versioned envelope decoder and the one-time legacy checkpoint migration.
//!
//! The decoder reads `schemaVersion` before anything else. A version above
//! what the reader supports is returned as `Future` (never dropped): replay
//! stops there and the journal stays off, untouched, rather than build or
//! repair a history it cannot fully read. An unknown `kind` is corruption,
//! not an extension point. A known kind labelled below its version
//! (`schema_table`) is corruption too, as is a versioned field written
//! as `null` or `[]`, which serde would read as absent (`check_raw`).
//!
//! A v1 record is upgraded conservatively (`v1`): its snapshot-era span
//! fields are dropped and it carries no provenance, so `apply` blocks every
//! live hunk it touches. A v1 record carrying a v2-only field or kind is
//! corrupt, never half-understood.

use serde::Deserialize;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::record::{
    Envelope, LegacyAnchor, Record, MAX_SUPPORTED_SCHEMA, SCHEMA_V1, SCHEMA_V3, SCHEMA_V5,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decoded {
    /// A record this reader understands (`schemaVersion` says which schema).
    Known(Box<Envelope>),
    Future {
        version: u32,
        seq: u64,
    },
}

pub fn encode(env: &Envelope) -> Vec<u8> {
    serde_json::to_vec(env).expect("schema types always serialize")
}

pub fn decode(payload: &[u8]) -> Result<Decoded, TxnError> {
    decode_with_max(payload, MAX_SUPPORTED_SCHEMA)
}

/// `decode` as a reader that supports schemas `1..=max` (a `max` of 1 is
/// what a v1-only build does with a v2 journal).
pub fn decode_with_max(payload: &[u8], max: u32) -> Result<Decoded, TxnError> {
    let mut value: serde_json::Value = serde_json::from_slice(payload)
        .map_err(|e| TxnError::Corrupt(format!("record is not JSON: {e}")))?;
    let version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| TxnError::Corrupt("record has no integer schemaVersion".into()))?;
    let version = u32::try_from(version)
        .map_err(|_| TxnError::Corrupt(format!("schemaVersion {version} out of range")))?;
    if version == 0 {
        return Err(TxnError::Corrupt(
            "schemaVersion 0 is not a journal version".into(),
        ));
    }
    if version > max {
        let seq = value
            .get("seq")
            .and_then(serde_json::Value::as_str)
            .and_then(crate::agent_journal::u64_wire::parse)
            .unwrap_or(0);
        return Ok(Decoded::Future { version, seq });
    }
    if version == SCHEMA_V1 {
        crate::agent_journal::codec_v1::upgrade(&mut value)
            .map_err(|e| TxnError::Corrupt(format!("invalid v1 record: {e}")))?;
    }
    Ok(Decoded::Known(Box::new(decode_known(value, version)?)))
}

/// One envelope of a version this reader supports. An `admission`'s items
/// go through this same path, each required to carry its frame's version,
/// v3 to v5 (any other child, or a nested frame, is corrupt — never
/// upgraded or skipped).
fn decode_known(mut value: serde_json::Value, version: u32) -> Result<Envelope, TxnError> {
    refuse_fields_on_unit_kinds(&value)?;
    crate::agent_journal::schema_table::check_raw(&value)?;
    let children = take_admission_items(&mut value);
    let mut env: Envelope = serde_json::from_value(value)
        .map_err(|e| TxnError::Corrupt(format!("invalid v{version} record: {e}")))?;
    if let (Some(children), Record::Admission { items }) = (children, &mut env.record) {
        for child in children {
            let v = child
                .get("schemaVersion")
                .and_then(serde_json::Value::as_u64);
            if v != Some(u64::from(version)) || !(SCHEMA_V3..=SCHEMA_V5).contains(&version) {
                let item = v.map_or_else(|| "no schemaVersion".into(), |v| format!("{v}"));
                return Err(TxnError::Corrupt(format!(
                    "seq {}: an admission labelled schemaVersion {version} carries an item \
                     labelled {item}; both must be one version, v3 to v5",
                    env.seq
                )));
            }
            if child.pointer("/record/kind") == Some(&serde_json::json!("admission")) {
                return Err(TxnError::Corrupt(format!(
                    "seq {}: a nested admission",
                    env.seq
                )));
            }
            items.push(decode_known(child, version)?);
        }
    }
    check_shape(&env)?;
    Ok(env)
}

/// An `admission`'s raw items, left as an empty array in `value` so the
/// frame deserializes without them.
fn take_admission_items(value: &mut serde_json::Value) -> Option<Vec<serde_json::Value>> {
    let record = value.get_mut("record")?.as_object_mut()?;
    if record.get("kind")? != "admission" {
        return None;
    }
    match record.get_mut("items")? {
        serde_json::Value::Array(items) => Some(std::mem::take(items)),
        _ => None,
    }
}

/// `deny_unknown_fields` cannot see extra keys beside the tag of a unit
/// variant (`uncommitted`), so they are refused here: a field this build
/// does not know must never be dropped by a rewrite.
fn refuse_fields_on_unit_kinds(value: &serde_json::Value) -> Result<(), TxnError> {
    let Some(record) = value.get("record").and_then(serde_json::Value::as_object) else {
        return Ok(());
    };
    match record.get("kind").and_then(serde_json::Value::as_str) {
        Some("uncommitted") if record.len() > 1 => Err(TxnError::Corrupt(
            "an uncommitted record carries unknown fields".into(),
        )),
        _ => Ok(()),
    }
}

/// Invariants serde cannot express: a v2 commit always carries its map; a
/// receipt names its own record; an admission keeps its frame rules; a
/// comment record keeps its static bindings (`comment::binding`).
fn check_shape(env: &Envelope) -> Result<(), TxnError> {
    crate::agent_journal::schema_table::check(env)?;
    crate::agent_journal::admission::receipt::check_binding(env)?;
    crate::agent_journal::admission::shape::check(env)?;
    crate::agent_journal::comment::binding::check(env)?;
    match &env.record {
        Record::Committed {
            provenance: None, ..
        } if env.schema_version != SCHEMA_V1 => Err(TxnError::Corrupt(
            "a v2 committed record has no provenance".into(),
        )),
        _ => Ok(()),
    }
}

/// One `mcp-checkpoints.jsonl` line, as `MCPCheckpoint` in `mcpStore.ts`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLine {
    id: String,
    tab_id: String,
    file_path: Option<String>,
    timestamp: u64,
    tool: String,
    #[serde(default)]
    description: String,
    content_before: String,
}

/// A migrated checkpoint plus the blob text the record references.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyMigration {
    pub record: Record,
    pub preimage_text: String,
}

/// The latest instant a JavaScript `Date` holds, in milliseconds: the
/// frontend refuses a checkpoint stamped later (`isEpochMillis`).
const DATE_MAX_MS: u64 = 8_640_000_000_000_000;

/// Convert one legacy line. Malformed lines are errors: the caller keeps the
/// original file until every line migrates, so nothing is lost. A line the
/// history panel could not show is malformed too — an empty id, tool or
/// chosen anchor, or a timestamp past `DATE_MAX_MS` — since one such entry
/// makes the panel refuse the whole checkpoint list.
pub fn migrate_legacy_line(line: &str) -> Result<LegacyMigration, TxnError> {
    let bad = |what: &str| TxnError::InvalidRequest(format!("legacy checkpoint line: {what}"));
    let l: LegacyLine = serde_json::from_str(line).map_err(|e| bad(&e.to_string()))?;
    let anchor = match l.file_path {
        Some(path) => LegacyAnchor::FilePath { path },
        None => LegacyAnchor::Tab { tab_id: l.tab_id },
    };
    let anchor_empty = match &anchor {
        LegacyAnchor::FilePath { path } => path.is_empty(),
        LegacyAnchor::Tab { tab_id } => tab_id.is_empty(),
    };
    if l.id.is_empty() || l.tool.is_empty() || anchor_empty {
        return Err(bad("an empty id, tool or anchor"));
    }
    if l.timestamp > DATE_MAX_MS {
        return Err(bad("a timestamp past the last JavaScript date"));
    }
    Ok(LegacyMigration {
        record: Record::LegacyCheckpoint {
            legacy_id: l.id,
            preimage: BlobHash::of_text(&l.content_before),
            postimage: None,
            anchor,
            tool: l.tool,
            description: l.description,
            timestamp: l.timestamp,
        },
        preimage_text: l.content_before,
    })
}
