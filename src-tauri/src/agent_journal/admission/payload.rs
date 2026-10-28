//! A framed payload: the identity fields every request names (the writer
//! incarnation, the page generation and the page identity) split from the
//! request body, and whether a frame may be answered at all.
//!
//! Key decisions:
//!   - The identity fields are required strings, parsed before anything is
//!     read: a malformed or missing one is `INVALID_REQUEST`, with no
//!     request state.
//!   - The digest is taken over the payload's raw bytes, identity fields
//!     included, so a request id is bound to the page that froze it.
//!   - The incarnation is checked before the generation's liveness: a
//!     payload from an earlier writer is `staleIncarnation` whatever its
//!     page.
//!
//! @module agent_journal/admission/payload

use serde_json::Value;

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::bound::RequestBind;
use crate::agent_journal::admission::identity::{parse_generation, Incarnation, PageIdentity};
use crate::agent_journal::admission::page_table::{Liveness, PageTable};
use crate::agent_journal::admission::prepare::Request;
use crate::agent_journal::admission::receipt::{PayloadDigest, RequestId};
use crate::agent_journal::controller::invalid;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::wire::check_json_text;
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

/// A framed payload's identity fields, and the rest of it.
pub(crate) struct Frame {
    pub(crate) digest: PayloadDigest,
    pub(crate) incarnation: Incarnation,
    pub(crate) generation: u64,
    pub(crate) identity: PageIdentity,
    pub(crate) rest: serde_json::Map<String, Value>,
}

impl Frame {
    /// Split `payload` into its identity fields and the request body.
    /// Text first: a lone surrogate is `INVALID_TEXT`, never the parse
    /// error serde_json would give it.
    pub(crate) fn decode(payload: &str) -> Result<Self, CommandError> {
        check_json_text(payload.as_bytes()).map_err(|e| refusal(&e))?;
        let digest = PayloadDigest::of(payload);
        let Ok(Value::Object(mut rest)) = serde_json::from_str::<Value>(payload) else {
            return Err(invalid("a framed payload is a JSON object"));
        };
        let mut field = |key: &str| match rest.remove(key) {
            Some(Value::String(s)) => Ok(s),
            _ => Err(invalid(&format!(
                "a framed payload names {key} as a string"
            ))),
        };
        let incarnation = field("incarnation")?;
        let generation = field("webviewGeneration")?;
        let identity = field("pageIdentity")?;
        let parsed = (|| {
            Ok::<_, TxnError>((
                Incarnation::parse(&incarnation)?,
                parse_generation(&generation)?,
                PageIdentity::parse(&identity)?,
            ))
        })();
        let (incarnation, generation, identity) = parsed.map_err(|e| refusal(&e))?;
        Ok(Self {
            digest,
            incarnation,
            generation,
            identity,
            rest,
        })
    }

    /// The request body, the identity fields removed.
    pub(crate) fn body(&self) -> String {
        Value::Object(self.rest.clone()).to_string()
    }

    pub(crate) fn request(&self, id: Option<RequestId>) -> Result<Request, CommandError> {
        let id = id.ok_or_else(|| invalid("a framed prepare names its requestId"))?;
        Ok(Request {
            id,
            digest: self.digest.clone(),
        })
    }

    pub(crate) fn bind(&self, r: &Request) -> RequestBind {
        RequestBind {
            request_id: r.id,
            digest: r.digest.clone(),
        }
    }
}

/// Whether the frame may be answered at all: its incarnation, then its
/// generation's liveness for `label`.
pub(crate) fn admit_identity(
    w: &Writer,
    pages: &PageTable,
    label: &str,
    f: &Frame,
) -> Result<(), RequestState> {
    if f.incarnation != *w.incarnation() {
        return Err(RequestState::StaleIncarnation);
    }
    match pages.liveness(label, f.generation, &f.identity) {
        Liveness::Own => Ok(()),
        Liveness::OtherIdentity | Liveness::OtherLabel => Err(RequestState::Conflict),
        Liveness::Dead => Err(RequestState::StaleGeneration),
    }
}
