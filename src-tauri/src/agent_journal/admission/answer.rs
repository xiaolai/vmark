//! The answer a request id gets once its payload has decoded: every refusal
//! from then on names the request (`{id, digest, state, …}`) and says
//! whether the caller can know the request's fate (`uncertain`).
//!
//! Key decisions:
//!   - The wire token follows the state, so one refusal type carries every
//!     reconciliation answer: an ended or fenced request and a stale
//!     incarnation or generation are `STALE_REQUEST`; another attempt in
//!     flight is `JOURNAL_BUSY`; an unhealthy writer is `JOURNAL_DEGRADED`;
//!     a reused id is `INVALID_REQUEST`. A request refused before admission
//!     (`notAdmitted`) keeps its cause's token and detail.
//!   - `uncertain` is a function of the state: only `notAdmitted`, a
//!     terminal (queued or durable) and `abandoned` prove the request's fate.
//!
//! @module agent_journal/admission/answer

use serde_json::{json, Map, Value};

use crate::agent_journal::admission::receipt::{PayloadDigest, RequestId};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;

/// A request-protocol refusal: the request it answers and its state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestRefusal {
    pub id: RequestId,
    pub digest: PayloadDigest,
    pub state: RequestState,
}

/// Where a request stands, as the caller is told (`request.state`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestState {
    /// Refused under the writer lock with nothing admitted; the id is
    /// fenced, so no later attempt is admitted either.
    NotAdmitted(TxnError),
    /// Another attempt of the request holds its in-flight entry.
    InFlight,
    /// The transaction is prepared and its terminal record is queued.
    TerminalPending(Ending),
    /// The transaction has a durable terminal record.
    Terminal(Ended),
    /// The id is fenced and has no receipt.
    Abandoned,
    /// The payload names another writer's incarnation.
    StaleIncarnation,
    /// The payload's page generation is not live for the invoking label.
    StaleGeneration,
    /// The id, or its generation, belongs to another payload or page.
    Conflict,
    /// The writer is unhealthy, or the failure was ambiguous.
    Unavailable,
}

/// A queued terminal record's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    Committed,
    Aborted,
    Uncommitted,
}

/// A durable terminal status. `prepared` is never one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    Committed,
    Aborted,
    Uncommitted,
    Discarded { by: TxnId },
    Resolved { by: TxnId },
}

impl RequestState {
    /// The wire token this answer refuses with.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAdmitted(cause) => cause.code(),
            Self::InFlight => "JOURNAL_BUSY",
            Self::TerminalPending(_)
            | Self::Terminal(_)
            | Self::Abandoned
            | Self::StaleIncarnation
            | Self::StaleGeneration => "STALE_REQUEST",
            Self::Conflict => "INVALID_REQUEST",
            Self::Unavailable => "JOURNAL_DEGRADED",
        }
    }

    /// Whether the caller cannot know the request's fate from this answer.
    pub fn uncertain(&self) -> bool {
        match self {
            Self::NotAdmitted(_)
            | Self::TerminalPending(_)
            | Self::Terminal(_)
            | Self::Abandoned => false,
            Self::InFlight
            | Self::StaleIncarnation
            | Self::StaleGeneration
            | Self::Conflict
            | Self::Unavailable => true,
        }
    }

    /// The wire name of the state (`request.state`).
    pub fn name(&self) -> &'static str {
        match self {
            Self::NotAdmitted(_) => "notAdmitted",
            Self::InFlight => "inFlight",
            Self::TerminalPending(_) => "terminalPending",
            Self::Terminal(_) => "terminal",
            Self::Abandoned => "abandoned",
            Self::StaleIncarnation => "staleIncarnation",
            Self::StaleGeneration => "staleGeneration",
            Self::Conflict => "conflict",
            Self::Unavailable => "unavailable",
        }
    }

    /// `state` plus `terminal`, `status` and `by` where the state has them.
    pub(crate) fn fields(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("state".into(), json!(self.name()));
        match self {
            Self::TerminalPending(e) => {
                m.insert("terminal".into(), json!(e.name()));
            }
            Self::Terminal(e) => {
                m.insert("status".into(), json!(e.name()));
                if let Ended::Discarded { by } | Ended::Resolved { by } = e {
                    m.insert("by".into(), json!(by));
                }
            }
            _ => {}
        }
        m
    }
}

impl Ending {
    pub fn name(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Aborted => "aborted",
            Self::Uncommitted => "uncommitted",
        }
    }
}

impl Ended {
    pub fn name(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Aborted => "aborted",
            Self::Uncommitted => "uncommitted",
            Self::Discarded { .. } => "discarded",
            Self::Resolved { .. } => "resolved",
        }
    }
}

impl RequestRefusal {
    /// The refusal for request `(id, digest)` in `state`.
    pub(crate) fn error(id: RequestId, digest: PayloadDigest, state: RequestState) -> TxnError {
        TxnError::Request(Box::new(Self { id, digest, state }))
    }

    /// `detail.request`: `{id, digest, state, terminal?, status?, by?}`.
    pub fn wire(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id.to_string()));
        m.insert("digest".into(), json!(self.digest));
        m.extend(self.state.fields());
        Value::Object(m)
    }
}
