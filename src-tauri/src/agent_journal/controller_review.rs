//! The review panel's decisions on the `Controller`: keep, un-keep, mark
//! handled and "Clear reviewed", each one `Writer::decide` record.
//!
//! Key decisions:
//!   - Only the user's own actions are admitted. `conflicted` and
//!     `revertFoundBase` are revert outcomes, decided by the revert
//!     admission under the writer lock after its own gate; from the panel
//!     they are `INVALID_REQUEST`, so a webview can never mark a hunk
//!     resolved without the three-way check that earns it.
//!   - `expectedHead` is mandatory (`null` is genesis): the decision is a
//!     CAS on the head the panel rendered as well as on each item's
//!     `reviewGen`, and a missing key is not read as genesis.
//!   - A key the journal has never seen is `STALE_REVIEW`, not minted: the
//!     panel rendered hunks the journal does not hold.
//!   - Retry safety is the CAS, not a receipt: a decision is applied at
//!     most once. One whose reply was lost and is sent again finds its
//!     `reviewGen` moved and is refused `STALE_REVIEW`, never applied twice;
//!     that refusal cannot say whether the first attempt landed, so the
//!     panel re-reads the history and shows what it holds.
//!   - A save captured but not linearized yet makes the decision
//!     `JOURNAL_BUSY` (`Writer::decide`): the panel's text is already gone.
//!
//! @module agent_journal/controller/review

use serde::{Deserialize, Serialize};

use crate::agent_journal::controller::{decode, Controller};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::review::{ReviewAction, ReviewItem};
use crate::agent_journal::writer_review::ReviewRequest;
use crate::command_error::CommandError;

/// The panel's decision (`payload` of `agent_journal_review_decide`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DecideRequest {
    doc_key: String,
    #[serde(deserialize_with = "crate::agent_journal::wire::required")]
    expected_head: Option<RevisionId>,
    action: ReviewAction,
    items: Vec<ReviewItem>,
}

/// The appended decision's journal generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecided {
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
}

impl Controller {
    /// Record one review decision; see the module docs.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload or a revert-only action;
    /// `STALE_REVIEW`, `JOURNAL_BUSY` or another journal refusal.
    pub fn review_decide(&self, payload: &str) -> Result<ReviewDecided, CommandError> {
        let req: DecideRequest = decode(payload)?;
        if matches!(
            req.action,
            ReviewAction::Conflicted | ReviewAction::RevertFoundBase
        ) {
            return Err(refusal(&TxnError::InvalidRequest(format!(
                "{:?} is decided by a revert, not by the panel",
                req.action
            ))));
        }
        let doc = self
            .docs
            .find(&req.doc_key)
            .map_err(|e| refusal(&e))?
            .ok_or_else(|| {
                refusal(&TxnError::StaleReview {
                    hunk: None,
                    detail: "the journal holds no such document".into(),
                })
            })?;
        let generation = self
            .writer
            .decide(ReviewRequest {
                doc,
                expected_head: req.expected_head,
                action: req.action,
                items: req.items,
            })
            .map_err(|e| refusal(&e))?;
        Ok(ReviewDecided { generation })
    }
}
