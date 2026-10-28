//! JSON entry points for the text-bearing operations. Each checks
//! well-formed text before decoding, so ill-formed text is `INVALID_TEXT`
//! with nothing appended, queued, reserved or hashed.
//!
//! An observational capture of ill-formed text is not an error to the
//! window: it reports `journaled: "no"` with reason `INVALID_TEXT`, and the
//! editor buffer stays exactly as it is (nothing here touches it).
//!
//! Test-only: the app reaches the writer through `controller`, whose
//! decoders share `wire::decode_json` with these.
#![cfg(test)]

use serde::Serialize;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::wire::decode_json as decode;
use crate::agent_journal::writer::{
    CommitOutcome, CommitRequest, PrepareRequest, Prepared, Writer,
};
use crate::agent_journal::writer_observe::{Journaled, ObserveRequest};

/// What a window learns from a capture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserveReply {
    /// `"pending"` (durable) or `"no"` (queued in memory, or refused).
    pub journaled: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<TxnId>,
    /// Set when the capture was refused rather than queued.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

impl Writer {
    pub fn prepare_json(&self, payload: &[u8]) -> Result<Prepared, TxnError> {
        self.prepare(decode::<PrepareRequest>(payload)?)
    }

    pub fn commit_json(&self, txn: TxnId, payload: &[u8]) -> Result<CommitOutcome, TxnError> {
        self.commit(txn, decode::<CommitRequest>(payload)?)
    }

    pub fn observe_json(&self, payload: &[u8]) -> Result<ObserveReply, TxnError> {
        let req = match decode::<ObserveRequest>(payload) {
            Err(TxnError::InvalidText(_)) => {
                return Ok(ObserveReply {
                    journaled: "no",
                    observation: None,
                    reason: Some("INVALID_TEXT"),
                })
            }
            other => other?,
        };
        let out = self.observe(req)?;
        let journaled = if out.journaled == Journaled::Pending {
            "pending"
        } else {
            "no"
        };
        Ok(ObserveReply {
            journaled,
            observation: Some(out.observation),
            reason: None,
        })
    }
}
