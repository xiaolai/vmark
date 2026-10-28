//! Review-only decisions (keep, unkeep, mark handled, conflicted, Clear
//! reviewed): one record, CAS on the document head and on every item's
//! `reviewGen`, all-or-nothing. Refused while the document is reserved
//! (`JOURNAL_BUSY`) or degraded, and while a captured save of it is not
//! linearized yet (`JOURNAL_BUSY`): such a save moves neither the head nor
//! any `reviewGen`, so the CAS alone would admit a decision on text the
//! panel no longer shows. A failed append is an error, not a queued
//! record: no content changed, so the panel simply retries.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::record::Record;
use crate::agent_journal::review::{ReviewAction, ReviewItem};
use crate::agent_journal::review_rules::check_decision;
use crate::agent_journal::writer::Writer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewRequest {
    pub doc: DocId,
    /// The head the review panel rendered.
    pub expected_head: Option<RevisionId>,
    pub action: ReviewAction,
    pub items: Vec<ReviewItem>,
}

impl Writer {
    /// Returns the generation of the appended decision.
    pub fn decide(&self, req: ReviewRequest) -> Result<u64, TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        g.not_busy(req.doc)?;
        if let Some(&holder) = g.proj.docs.get(&req.doc).and_then(|d| d.pending.first()) {
            return Err(TxnError::JournalBusy { holder });
        }
        if g.proj.head(req.doc) != req.expected_head {
            return Err(TxnError::StaleReview {
                hunk: None,
                detail: "the document changed since the panel rendered".into(),
            });
        }
        check_decision(g.proj.docs.get(&req.doc), req.action, &req.items)?;
        let record = Record::ReviewDecision {
            doc: req.doc,
            expected_head: req.expected_head,
            action: req.action,
            items: req.items,
        };
        Ok(self.append(&mut g, TxnId::new(), record, &[])?.seq)
    }
}
