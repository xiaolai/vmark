//! A request's provenance map, decoded apart from the request. A map a
//! window built wrongly (a bad version, body or cap) must not fail the
//! operation carrying it at decoding: it is refused as
//! `TxnError::InvalidProvenance` (`field: provenance`) like a map that does
//! not certify its texts, and the window resends without it.
//!
//! @module agent_journal/provenance_field

use serde::{Deserialize, Deserializer};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::provenance::ProvenancePayload;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvenanceField(Result<ProvenancePayload, String>);

impl ProvenanceField {
    /// The validated map, or the refusal naming the field.
    pub fn decode(self) -> Result<ProvenancePayload, TxnError> {
        self.0
            .map_err(|e| TxnError::InvalidProvenance(format!("provenance: {e}")))
    }
}

impl<'de> Deserialize<'de> for ProvenanceField {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        Ok(Self(
            serde_json::from_value(value).map_err(|e| e.to_string()),
        ))
    }
}

/// Decode an optional field; `None` stays `None`.
pub fn decode_field(field: Option<ProvenanceField>) -> Result<Option<ProvenancePayload>, TxnError> {
    field.map(ProvenanceField::decode).transpose()
}
