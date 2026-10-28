//! Schema v1 → v2 upgrade of one decoded record, in JSON before typing.
//!
//! v1 spans carried `textHash` and the snapshot-guess fields (`hull`,
//! `doubt`, `woken`), and hunks a creation `doubt`; v2 retires all of them,
//! so they are dropped rather than trusted. `growing` defaults to "the range
//! is empty" (v1 records predate it) and `block` to `null` — `apply`
//! then blocks every live hunk of a v1 revision (`snapshotOnly`,
//! origin `schemaV1`): no v1 record has a provenance map, so its placement
//! is unknown, never exact.

use serde_json::{Map, Value};

/// The v1 record kinds; anything else (an epoch record, say) is not v1.
const V1_KINDS: [&str; 13] = [
    "journalHeader",
    "prepared",
    "aborted",
    "committed",
    "uncommitted",
    "discarded",
    "pendingObservation",
    "observedRevision",
    "concurrentObservation",
    "gap",
    "reviewDecision",
    "tombstone",
    "legacyCheckpoint",
];
const V1_SPAN_ONLY: [&str; 4] = ["textHash", "hull", "doubt", "woken"];
const V2_SPAN_ONLY: [&str; 2] = ["block", "lastCertified"];

pub(crate) fn upgrade(env: &mut Value) -> Result<(), String> {
    let record = env
        .get_mut("record")
        .and_then(Value::as_object_mut)
        .ok_or("record is not an object")?;
    let kind = record
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("record has no kind")?;
    if !V1_KINDS.contains(&kind) {
        return Err(format!("{kind:?} is not a v1 record kind"));
    }
    if record.contains_key("provenance") {
        return Err("provenance is a v2 field".into());
    }
    if let Some(hunks) = record.get_mut("hunks") {
        upgrade_hunks(hunks)?;
    }
    if let Some(effects) = record.get_mut("effects").and_then(Value::as_object_mut) {
        if let Some(hunks) = effects.get_mut("newHunks") {
            upgrade_hunks(hunks)?;
        }
        if let Some(spans) = effects.get_mut("spans") {
            for span in spans.as_array_mut().ok_or("spans is not an array")? {
                upgrade_span(span.as_object_mut().ok_or("span is not an object")?)?;
            }
        }
    }
    Ok(())
}

fn upgrade_hunks(hunks: &mut Value) -> Result<(), String> {
    for h in hunks.as_array_mut().ok_or("hunks is not an array")? {
        h.as_object_mut()
            .ok_or("hunk is not an object")?
            .remove("doubt");
    }
    Ok(())
}

fn upgrade_span(span: &mut Map<String, Value>) -> Result<(), String> {
    if let Some(k) = V2_SPAN_ONLY.iter().find(|k| span.contains_key(**k)) {
        return Err(format!("{k} is a v2 span field"));
    }
    for k in V1_SPAN_ONLY {
        span.remove(k);
    }
    if !span.contains_key("growing") {
        let range = span.get("range").ok_or("span has no range")?;
        let empty = range.get("from").is_some() && range.get("from") == range.get("to");
        span.insert("growing".into(), Value::Bool(empty));
    }
    span.insert("block".into(), Value::Null);
    Ok(())
}
