//! The per-version table of record kinds and fields.
//!
//! Each kind (and, from v3 on, each versioned field) has the lowest schema
//! version that may carry it. The decoder refuses a record labelled below
//! that version as `Corrupt`: a v3 kind under a v2 label would be read by a
//! v2 build as something it is not. A label above the minimum is allowed,
//! so a v3 record of a v2 kind decodes. The writer labels each new record
//! with its minimum, never below v2 (`label`), so a journal that uses
//! nothing newer stays readable by a v2 build.
//!
//! The match is exhaustive on purpose: a new kind does not compile until it
//! names its version here. A v3 field joins its kind's arm as a pattern on
//! that field. The v1 → v2 field differences are vetted earlier, in JSON,
//! by `codec_v1`.

use crate::agent_journal::admission::receipt::{Outcome, PreparedResponse, Receipt};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::record::{
    Envelope, Record, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5,
};

/// The lowest schema version that may carry `record`.
pub(crate) fn min_schema(record: &Record) -> u32 {
    match record {
        Record::Prepared {
            certificate: Some(_),
            ..
        } => SCHEMA_V3,
        Record::Committed { addresses, .. } | Record::Tombstone { addresses, .. }
            if !addresses.is_empty() =>
        {
            SCHEMA_V5
        }
        Record::JournalHeader { .. }
        | Record::Prepared { .. }
        | Record::Aborted { .. }
        | Record::Committed { .. }
        | Record::Uncommitted
        | Record::Discarded { .. }
        | Record::PendingObservation { .. }
        | Record::ObservedRevision { .. }
        | Record::ConcurrentObservation { .. }
        | Record::Gap { .. }
        | Record::ReviewDecision { .. }
        | Record::Tombstone { .. }
        | Record::LegacyCheckpoint { .. } => SCHEMA_V1,
        Record::EpochArmed { .. } | Record::EpochClosed { .. } | Record::EpochUnclosed { .. } => {
            SCHEMA_V2
        }
        Record::Admission { .. } => SCHEMA_V3,
        Record::CommentCreated(_)
        | Record::CommentReplied(_)
        | Record::CommentState(_)
        | Record::CommentDeleted(_) => SCHEMA_V5,
    }
}

/// The version a newly written `record` is labelled with: its minimum, but
/// at least v2 (this build's records carry v2 provenance semantics).
pub(crate) fn label(record: &Record) -> u32 {
    min_schema(record).max(SCHEMA_V2)
}

/// The schema a receipt's outcome belongs to: a controlled write's or a
/// restore's reply is v3; an applied revert's reply and a revert's
/// decision are v4; a created thread and a reply are v5. An envelope with a receipt is labelled exactly this
/// (`receipt::check_binding`).
pub(crate) fn receipt_min(receipt: &Receipt) -> u32 {
    match &receipt.outcome {
        Outcome::Prepared(PreparedResponse::Controlled(_) | PreparedResponse::Restore(_)) => {
            SCHEMA_V3
        }
        Outcome::Prepared(PreparedResponse::Revert(_)) | Outcome::Decision(_) => SCHEMA_V4,
        Outcome::CommentCreated(_) | Outcome::CommentReplied(_) => SCHEMA_V5,
    }
}

/// Refuse a record labelled below the version of its kind or fields (a
/// receipt is a field of any envelope that may carry one, of its
/// outcome's version).
pub(crate) fn check(env: &Envelope) -> Result<(), TxnError> {
    let receipt = env.receipt.as_ref().map_or(SCHEMA_V1, receipt_min);
    let min = min_schema(&env.record).max(receipt);
    if env.schema_version < min {
        return Err(TxnError::Corrupt(format!(
            "a v{min} record kind or field is labelled schemaVersion {}",
            env.schema_version
        )));
    }
    Ok(())
}

/// The versioned fields, as (`at`, key): `None` the envelope, else the record.
const VERSIONED_FIELDS: [(Option<&str>, &str); 3] = [
    (None, "receipt"),
    (Some("record"), "certificate"),
    (Some("record"), "addresses"),
];

/// Refuse a versioned field written as `null` or `[]`. Serde reads either
/// as absent, so `check` could not see it labelled below its version; the
/// writer never emits one (each is skipped when empty), so at any label it
/// is not a record this build wrote.
pub(crate) fn check_raw(value: &serde_json::Value) -> Result<(), TxnError> {
    for (at, key) in VERSIONED_FIELDS {
        let object = at.map_or(Some(value), |at| value.get(at));
        let empty = match object.and_then(|o| o.get(key)) {
            Some(serde_json::Value::Null) => true,
            Some(serde_json::Value::Array(items)) => items.is_empty(),
            _ => false,
        };
        if empty {
            return Err(TxnError::Corrupt(format!(
                "a versioned field `{key}` is present but empty"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "schema_table.test.rs"]
mod tests;
