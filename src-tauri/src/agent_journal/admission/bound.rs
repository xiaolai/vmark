//! The envelopes a framed request's success reply travels in: the reply
//! beside the arguments that bind it, so a caller can match a reply to the
//! request it sent without trusting the transport's ordering.
//!
//! Key decisions:
//!   - A prepare (agent write or restore) is bound by its request id and
//!     payload digest; a commit or abort by its transaction and the page
//!     pair it named. The generation is a canonical decimal string.
//!   - The envelope is wire-only: the persisted receipt stores the bare
//!     reply, so its bytes are unchanged.
//!   - A command with no request key (a capture, an epoch, the history
//!     panel's reads, …) is bound by a call id the caller mints per call:
//!     32 lowercase hex, checked before the command does anything, echoed
//!     unchanged. It names one call, so it binds a reply and nothing else.
//!
//! @module agent_journal/admission/bound

use std::future::Future;

use serde::Serialize;

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::identity::is_hex32;
use crate::agent_journal::admission::receipt::{PayloadDigest, RequestId};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::refusal::refusal;
use crate::command_error::CommandError;

/// `{bind, reply}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Bound<B, R> {
    pub bind: B,
    pub reply: R,
}

/// What binds a prepare's reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestBind {
    pub request_id: RequestId,
    pub digest: PayloadDigest,
}

/// What binds a commit's or abort's reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairBind {
    pub txn: TxnId,
    pub page_identity: String,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub webview_generation: u64,
}

/// What binds the reply of a command with no request key: the caller's
/// call id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallBind {
    call_id: String,
}

impl CallBind {
    /// `call_id` as a bind; anything but 32 lowercase hex is `INVALID_REQUEST`.
    pub fn parse(call_id: &str) -> Result<Self, CommandError> {
        if is_hex32(call_id) {
            Ok(Self {
                call_id: call_id.to_owned(),
            })
        } else {
            Err(refusal(&TxnError::InvalidRequest(
                "callId must be 32 lowercase hex digits".into(),
            )))
        }
    }
}

/// Run `work` for the call `call_id` names and envelope its reply. A
/// malformed id is refused before `work` is polled, so nothing runs.
pub async fn bind_call<T>(
    call_id: &str,
    work: impl Future<Output = Result<T, CommandError>>,
) -> Result<Bound<CallBind, T>, CommandError> {
    let bind = CallBind::parse(call_id)?;
    Ok(Bound {
        bind,
        reply: work.await?,
    })
}

/// What an abandon did, or found already done.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AbandonReply {
    /// The prepared transaction was aborted, durably.
    Aborted,
    /// Its `aborted` record is queued; the reservation holds until it lands.
    AbortQueued,
    /// The id is fenced: no attempt of it will be admitted.
    Fenced,
    /// The request had already ended (or its ending is queued).
    Ended(RequestState),
    /// The request was a revert that recorded a decision: nothing is open.
    Decided,
    /// The request was a comment create or reply that was answered (its
    /// record kind): it is final and nothing is open.
    Answered(&'static str),
}

impl Serialize for AbandonReply {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let fields = match self {
            Self::Aborted => serde_json::json!({ "state": "aborted" }),
            Self::AbortQueued => serde_json::json!({ "state": "abortQueued" }),
            Self::Fenced => serde_json::json!({ "state": "fenced" }),
            Self::Decided => serde_json::json!({ "state": "decided" }),
            Self::Answered(kind) => serde_json::json!({ "state": "answered", "kind": kind }),
            Self::Ended(state) => serde_json::Value::Object(state.fields()),
        };
        fields.serialize(s)
    }
}
