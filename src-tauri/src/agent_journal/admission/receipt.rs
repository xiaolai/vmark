//! A request receipt: the id a window minted for one prepare, the SHA-256
//! of the raw payload it sent, and the reply exactly as first returned.
//! Stored on the record it answers, so an identical retry after a lost
//! reply gets the same bytes back with no second write, and a different
//! payload under the same id is refused.
//!
//! Outcomes: a `prepared` reply (a controlled write's or a restore's from
//! schema v3, an applied revert's from v4), or the review decision a
//! revert that did not apply recorded instead (v4), or a created comment
//! thread or a reply (v5, final: they open no transaction). An envelope
//! with a receipt is labelled exactly its outcome's schema (`schema_table`).
//!
//! Static binding: the stored reply names the record's own document,
//! transaction and revision; a revert's names the hunk and `reviewGen` its
//! `hunkRevert` op prepared, and only a `hunkRevert` carries one. A
//! decision names the record's document, action, its one hunk, head and
//! seq; the `reviewGen` it reports is checked once the record applies
//! (`Projection::apply`). A comment answer names its own record
//! (`comment::binding`). A receipt anywhere else — another kind, a v1 or
//! v2 envelope, an admission frame itself — is corrupt.
//!
//! @module agent_journal/admission/receipt

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use sha2_v011::{Digest as _, Sha256};
use uuid::Uuid;

use crate::agent_journal::comment::binding;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::comment::replies::{CommentCreatedReply, CommentRepliedReply};
use crate::agent_journal::controlled_restore::RestorePrepared;
use crate::agent_journal::controlled_revert::{RevertDecided, RevertPrepared};
use crate::agent_journal::controlled_wire::ControlledPrepared;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::schema_table::receipt_min;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub request_id: RequestId,
    pub digest: PayloadDigest,
    pub outcome: Outcome,
}

/// What the request produced: a `prepared` reply, the review decision a
/// revert that did not apply recorded, or a comment create's or reply's
/// answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "response",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Outcome {
    Prepared(PreparedResponse),
    Decision(RevertDecided),
    CommentCreated(CommentCreatedReply),
    CommentReplied(CommentRepliedReply),
}

/// A controlled prepare's reply, a restore's (which also carries the text
/// to apply), or an applied revert's (its exact patch). Told apart by
/// their fields; each refuses unknown ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PreparedResponse {
    Controlled(ControlledPrepared),
    Restore(RestorePrepared),
    Revert(RevertPrepared),
}

impl PreparedResponse {
    /// The document, transaction, revision and generation the reply names.
    fn names(&self) -> (DocId, TxnId, RevisionId, u64) {
        match self {
            Self::Controlled(p) => (p.doc, p.txn, p.revision, p.generation),
            Self::Restore(p) => (p.doc, p.txn, p.revision, p.generation),
            Self::Revert(p) => (p.doc, p.txn, p.revision, p.generation),
        }
    }

    /// The transaction the reply prepared.
    pub(crate) fn txn(&self) -> TxnId {
        self.names().1
    }
}

impl Outcome {
    /// The document the outcome is about.
    pub(crate) fn doc(&self) -> DocId {
        match self {
            Self::Prepared(r) => r.names().0,
            Self::Decision(d) => d.doc,
            Self::CommentCreated(c) => c.doc,
            Self::CommentReplied(r) => r.doc,
        }
    }

    /// The transaction a `prepared` reply opened; every other outcome is
    /// final and opens none.
    pub(crate) fn txn(&self) -> Option<TxnId> {
        match self {
            Self::Prepared(r) => Some(r.txn()),
            Self::Decision(_) | Self::CommentCreated(_) | Self::CommentReplied(_) => None,
        }
    }

    /// The thread a comment answer is about.
    pub(crate) fn comment(&self) -> Option<CommentId> {
        match self {
            Self::CommentCreated(c) => Some(c.comment),
            Self::CommentReplied(r) => Some(r.comment),
            Self::Prepared(_) | Self::Decision(_) => None,
        }
    }
}

impl Receipt {
    /// The transaction whose `prepared` stores this receipt; `None` for a
    /// decision's.
    pub fn txn(&self) -> Option<TxnId> {
        self.outcome.txn()
    }
}

/// A receipt is legal only on the record it answers, labelled exactly its
/// outcome's schema, naming that record. See the module docs.
pub fn check_binding(env: &Envelope) -> Result<(), TxnError> {
    let Some(receipt) = &env.receipt else {
        return Ok(());
    };
    let corrupt = |why: &str| TxnError::Corrupt(format!("seq {}: {why}", env.seq));
    if env.schema_version != receipt_min(receipt) {
        return Err(TxnError::Corrupt(format!(
            "seq {}: a receipt on a schema {} envelope",
            env.seq, env.schema_version
        )));
    }
    match (&receipt.outcome, &env.record) {
        (
            Outcome::Prepared(response),
            Record::Prepared {
                doc,
                revision,
                review_op,
                ..
            },
        ) => {
            if response.names() != (*doc, env.txn, *revision, env.seq) {
                return Err(corrupt(
                    "the receipt names another document, transaction, revision or generation",
                ));
            }
            match (response, review_op) {
                (
                    PreparedResponse::Revert(r),
                    ReviewOp::HunkRevert {
                        hunk_id,
                        expected_review_gen,
                    },
                ) if r.hunk == *hunk_id && r.review_gen == *expected_review_gen => Ok(()),
                (PreparedResponse::Revert(_), _) | (_, ReviewOp::HunkRevert { .. }) => {
                    Err(corrupt("the receipt names another revert"))
                }
                _ => Ok(()),
            }
        }
        (
            Outcome::Decision(d),
            Record::ReviewDecision {
                doc,
                expected_head,
                action,
                items,
            },
        ) => {
            let one = matches!(items.as_slice(), [i] if i.hunk_id == d.hunk);
            if d.doc != *doc
                || d.action != *action
                || !one
                || d.head != *expected_head
                || d.generation != env.seq
            {
                return Err(corrupt("the receipt names another decision"));
            }
            Ok(())
        }
        (Outcome::CommentCreated(r), _) => binding::created_receipt(env, r),
        (Outcome::CommentReplied(r), _) => binding::replied_receipt(env, r),
        _ => Err(corrupt("a receipt on a record it does not answer")),
    }
}

/// A window-minted request id: a lowercase, hyphenated RFC 4122 v4 UUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RequestId(Uuid);

impl FromStr for RequestId {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        let id = Uuid::parse_str(s).map_err(|e| format!("request id: {e}"))?;
        let canonical = id.hyphenated().to_string();
        if canonical != s || id.get_version_num() != 4 || id.get_variant() != uuid::Variant::RFC4122
        {
            return Err(format!("request id {s:?} is not a lowercase v4 UUID"));
        }
        Ok(Self(id))
    }
}

impl TryFrom<String> for RequestId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        s.parse()
    }
}

impl From<RequestId> for String {
    fn from(id: RequestId) -> String {
        id.to_string()
    }
}

impl fmt::Display for RequestId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.hyphenated().fmt(f)
    }
}

/// Lowercase hex SHA-256 of a request's raw payload string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PayloadDigest(String);

impl PayloadDigest {
    /// The digest of `payload` exactly as received, before any decoding.
    pub fn of(payload: &str) -> Self {
        let bytes = Sha256::digest(payload.as_bytes());
        Self(bytes.iter().map(|b| format!("{b:02x}")).collect())
    }
}

impl FromStr for PayloadDigest {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        let hex = |c: u8| c.is_ascii_digit() || (b'a'..=b'f').contains(&c);
        if s.len() != 64 || !s.bytes().all(hex) {
            return Err(format!("digest {s:?} is not 64 lowercase hex digits"));
        }
        Ok(Self(s.to_owned()))
    }
}

impl TryFrom<String> for PayloadDigest {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        s.parse()
    }
}

impl From<PayloadDigest> for String {
    fn from(d: PayloadDigest) -> String {
        d.0
    }
}
