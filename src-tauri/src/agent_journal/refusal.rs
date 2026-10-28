//! Journal refusals as `CommandError`s. The class (`conflict`,
//! `invalid-input`, …) is what generic frontend code branches on; the exact
//! journal token rides in `detail.journalCode`, with the current head for
//! `STALE_PARENT` and `field: "provenance"` for a map that does not certify
//! its texts (the window resends without it), `field: "addresses"` for a
//! write's `addresses` that is not a set of unresolved threads, and `indeterminate: true`
//! with `uncertain: true` for a prepare whose frame may or may not be
//! durable (the client treats it as any uncertain answer); a request answer
//! adds `uncertain` and `request` (`admission::answer`); a registration
//! for a window that is not open adds `uncertain` and `state`. A comment
//! refusal adds what it is about: the thread, the bound and its limit, or
//! the action, caller and state the matrix refused. Messages are for
//! agents and logs, never shown to a user.
//!
//! @module agent_journal/refusal

use serde_json::{json, Value};

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::errors::TxnError;
use crate::command_error::{CommandError, ErrorCode};

/// Map a writer refusal onto the command contract.
pub fn refusal(e: &TxnError) -> CommandError {
    CommandError::new(class(e), e.to_string()).with_detail(detail(e))
}

/// The command-error class generic frontend code branches on.
fn class(e: &TxnError) -> ErrorCode {
    match e {
        TxnError::JournalBusy { .. }
        | TxnError::StaleParent { .. }
        | TxnError::JournalDegraded
        | TxnError::StaleReview { .. }
        | TxnError::AmbiguousRevert { .. }
        | TxnError::RevertRefused { .. }
        | TxnError::ReviewBacklogFull { .. }
        | TxnError::ReviewStateExhausted { .. }
        | TxnError::Saturated(_)
        | TxnError::StalePage(_)
        | TxnError::StaleRegistration(_)
        | TxnError::StaleComment { .. }
        | TxnError::CommentStateExhausted { .. }
        | TxnError::CommentStorageFull { .. }
        | TxnError::CommentNotAllowed { .. } => ErrorCode::Conflict,
        TxnError::CommentLimit { bound, .. } => match *bound {
            "body" | "headingPath" => ErrorCode::InvalidInput,
            _ => ErrorCode::Conflict,
        },
        TxnError::Request(r) => match &r.state {
            RequestState::NotAdmitted(cause) => class(cause),
            RequestState::Conflict => ErrorCode::InvalidInput,
            RequestState::InFlight
            | RequestState::TerminalPending(_)
            | RequestState::Terminal(_)
            | RequestState::Abandoned
            | RequestState::StaleIncarnation
            | RequestState::StaleGeneration
            | RequestState::Unavailable => ErrorCode::Conflict,
        },
        TxnError::InvalidRequest(_)
        | TxnError::InvalidProvenance(_)
        | TxnError::InvalidAddresses(_)
        | TxnError::InvalidText(_)
        | TxnError::CommentAnchorTooLong { .. } => ErrorCode::InvalidInput,
        TxnError::Io(_) | TxnError::Indeterminate(_) => ErrorCode::Io,
        TxnError::Invariant(_) | TxnError::Corrupt(_) => ErrorCode::Internal,
        TxnError::FutureFormat { .. } => ErrorCode::Unsupported,
    }
}

/// `detail`: the journal token and what the refusal names. A request
/// answer adds `uncertain` and `request` to its cause's detail.
fn detail(e: &TxnError) -> Value {
    match e {
        TxnError::StaleParent { head } => json!({ "journalCode": e.code(), "head": head }),
        TxnError::AmbiguousRevert { hunk, block } => {
            json!({ "journalCode": e.code(), "hunk": hunk, "block": block })
        }
        TxnError::RevertRefused { hunk, reason } => {
            json!({ "journalCode": e.code(), "hunk": hunk, "reason": reason })
        }
        TxnError::InvalidProvenance(_) => json!({ "journalCode": e.code(), "field": "provenance" }),
        TxnError::InvalidAddresses(_) => json!({ "journalCode": e.code(), "field": "addresses" }),
        TxnError::CommentAnchorTooLong { bytes, limit } => {
            json!({ "journalCode": e.code(), "bytes": bytes, "limit": limit })
        }
        TxnError::StaleComment { comment, .. } | TxnError::CommentStateExhausted { comment } => {
            json!({ "journalCode": e.code(), "comment": comment })
        }
        TxnError::CommentStorageFull { bytes, limit } => {
            json!({ "journalCode": e.code(), "bytes": bytes, "limit": limit })
        }
        TxnError::CommentLimit {
            bound,
            limit,
            total,
        } => json!({ "journalCode": e.code(), "bound": bound, "limit": limit, "total": total }),
        TxnError::CommentNotAllowed {
            action,
            caller,
            state,
        } => json!({ "journalCode": e.code(), "action": action, "caller": caller, "state": state }),
        TxnError::Indeterminate(_) => {
            json!({ "journalCode": e.code(), "indeterminate": true, "uncertain": true })
        }
        TxnError::StaleRegistration(_) => {
            json!({ "journalCode": e.code(), "uncertain": true, "state": "staleGeneration" })
        }
        TxnError::Request(r) => {
            let mut d = match &r.state {
                RequestState::NotAdmitted(cause) => detail(cause),
                _ => json!({ "journalCode": e.code() }),
            };
            d["uncertain"] = json!(r.state.uncertain());
            d["request"] = r.wire();
            d
        }
        _ => json!({ "journalCode": e.code() }),
    }
}

/// The journal did not start (or has not finished starting).
pub fn unavailable() -> CommandError {
    CommandError::conflict("JOURNAL_UNAVAILABLE: the agent edit journal is not running")
        .with_detail(json!({ "journalCode": "JOURNAL_UNAVAILABLE" }))
}
