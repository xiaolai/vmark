//! The `prepared` record a prepare mints, after the checks that follow
//! admission: parent CAS, preimage = head text, the certificate's binding,
//! the op (slot admission, restore source, revert CAS) and a revert's plan.
//! Pure over a projection and a blob view, so the writer's single-record
//! prepare and a staged admission (checked against its clone, after the
//! items before it) run the same checks and mint the same record.
//!
//! A revert that applies mints a `prepared` with its exact patch, checked
//! against the plan's postimage. One that does not apply mints nothing
//! here: its outcome is handed back, and `revert_decision` turns it into
//! the one review decision it records (or `REVERT_REFUSED`).
//!
//! @module agent_journal/admission/prepared_record

use crate::agent_journal::admission::blobs::BlobRead;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::Record;
use crate::agent_journal::revert_gate::RevertDecision;
use crate::agent_journal::review::{HunkState, Range, ReviewAction, ReviewItem, ReviewOp};
use crate::agent_journal::review_rules::{check_decision, check_prepare, decision_target, hunk_at};
use crate::agent_journal::text::{utf16_len, utf16_slices};
use crate::agent_journal::writer::PrepareRequest;
use crate::agent_journal::writer_epoch::basis_of;
use crate::agent_journal::writer_revert::plan;

/// A `prepared` record minted against `p`, with the preimage text it
/// names (stored before the record).
pub(crate) struct PreparedRecord {
    pub(crate) txn: TxnId,
    pub(crate) revision: RevisionId,
    pub(crate) record: Record,
    pub(crate) pre: BlobHash,
    pub(crate) preimage: String,
    /// For an applied revert: the exact patch its reply hands the window.
    pub(crate) revert: Option<RevertPatch>,
}

/// An applied revert's patch: `from..to` of the preimage becomes `insert`,
/// which gives the text hashed `postimage_hash`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RevertPatch {
    pub(crate) hunk: HunkId,
    /// The `reviewGen` the revert was prepared against.
    pub(crate) review_gen: u64,
    pub(crate) from: u64,
    pub(crate) to: u64,
    pub(crate) insert: String,
    pub(crate) postimage_hash: BlobHash,
}

/// What a prepare's checks minted.
pub(crate) enum Mint {
    Prepared(Box<PreparedRecord>),
    /// A revert that does not apply: `hunk` at `review_gen`, and why.
    NotApplied {
        hunk: HunkId,
        review_gen: u64,
        decision: RevertDecision,
    },
}

impl Mint {
    /// The `prepared`, for a caller that records no revert decision.
    pub(crate) fn prepared(self) -> Result<PreparedRecord, TxnError> {
        match self {
            Self::Prepared(r) => Ok(*r),
            Self::NotApplied { decision, .. } => Err(TxnError::InvalidRequest(format!(
                "the revert does not apply: {decision:?}"
            ))),
        }
    }
}

/// The review decision a revert that did not apply records, built against
/// `p`.
pub(crate) struct DecidedRecord {
    pub(crate) record: Record,
    pub(crate) hunk: HunkId,
    pub(crate) action: ReviewAction,
    pub(crate) head: Option<RevisionId>,
    /// The hunk's `reviewGen` once the decision applies.
    pub(crate) review_gen: u64,
}

/// Prepare's checks after admission — parent CAS, preimage = head text,
/// the certificate's binding, the op, a revert's plan — against `p` and
/// `blobs`, then the minted record. Appends nothing: the caller writes it
/// alone or as an admission's last item.
pub(crate) fn prepared_record(
    p: &Projection,
    blobs: &mut dyn BlobRead,
    req: PrepareRequest,
) -> Result<Mint, TxnError> {
    let head = p.head(req.doc);
    if head != req.parent {
        return Err(TxnError::StaleParent { head });
    }
    // The preimage is the head text; before the first revision the
    // recorded baseline is genesis `""`. Unsaved text is observed first.
    let pre = BlobHash::of_text(&req.preimage);
    if p.postimage_of(head).as_ref() != Some(&pre) {
        return Err(TxnError::StaleParent { head });
    }
    if let Some(c) = &req.certificate {
        if c.basis() != basis_of(req.parent) || c.pre_hash() != pre.digest_hex() {
            return Err(TxnError::InvalidRequest(
                "the certificate is not bound to the parent".into(),
            ));
        }
    }
    check_prepare(p, req.doc, &req.review_op)?;
    let mut revert = None;
    if let ReviewOp::HunkRevert {
        hunk_id,
        expected_review_gen,
    } = &req.review_op
    {
        match plan(p, blobs, req.doc, hunk_id, &req.preimage)?.decision {
            RevertDecision::Apply {
                from,
                to,
                restored,
                postimage,
            } => {
                let insert = revert_insert(&req.preimage, (from, to), restored, &postimage)
                    .map_err(|e| TxnError::Invariant(format!("revert of {}: {e}", hunk_id.0)))?;
                revert = Some(RevertPatch {
                    hunk: hunk_id.clone(),
                    review_gen: *expected_review_gen,
                    from,
                    to,
                    insert,
                    postimage_hash: BlobHash::of_text(&postimage),
                });
            }
            decision => {
                return Ok(Mint::NotApplied {
                    hunk: hunk_id.clone(),
                    review_gen: *expected_review_gen,
                    decision,
                })
            }
        }
    }
    let (txn, revision) = (TxnId::new(), RevisionId::new());
    let record = Record::Prepared {
        doc: req.doc,
        parent: req.parent,
        revision,
        preimage: pre.clone(),
        actor: req.actor,
        initiator: req.initiator,
        tool: req.tool,
        review_op: req.review_op,
        certificate: req.certificate,
    };
    Ok(Mint::Prepared(Box::new(PreparedRecord {
        txn,
        revision,
        record,
        pre,
        preimage: req.preimage,
        revert,
    })))
}

/// The text an applied revert inserts: the `restored` text of
/// `postimage`, which must give `postimage` back in place of `from..to` of
/// `preimage`.
fn revert_insert(
    preimage: &str,
    (from, to): (u64, u64),
    restored: Range,
    postimage: &str,
) -> Result<String, String> {
    let insert = utf16_slices(postimage, &[restored])?[0].to_owned();
    let around = [
        Range {
            start: 0,
            end: from,
        },
        Range {
            start: to,
            end: utf16_len(preimage),
        },
    ];
    let kept = utf16_slices(preimage, &around)?;
    if restored.start != from || format!("{}{insert}{}", kept[0], kept[1]) != postimage {
        return Err("the patch does not give the planned postimage".into());
    }
    Ok(insert)
}

/// The one review decision a revert of `hunk` (at `review_gen`) that did
/// not apply records against `p`: `conflicted` or `revertFoundBase`, when
/// legal from the hunk's state. A conflicted hunk that conflicts again, or
/// a reverted hunk that cannot be re-applied, has no decision to record:
/// `REVERT_REFUSED`.
pub(crate) fn revert_decision(
    p: &Projection,
    doc: DocId,
    hunk: &HunkId,
    review_gen: u64,
    decision: &RevertDecision,
) -> Result<DecidedRecord, TxnError> {
    let action = match decision {
        RevertDecision::Conflicted => ReviewAction::Conflicted,
        RevertDecision::FoundBase => ReviewAction::RevertFoundBase,
        RevertDecision::Apply { .. } => {
            return Err(TxnError::Invariant(
                "an applied revert has no decision".into(),
            ))
        }
    };
    let d = p.docs.get(&doc);
    let state = hunk_at(d, hunk, review_gen)?.state;
    if decision_target(action, state).is_none() {
        let reason = if state == HunkState::Reverted {
            "reapply"
        } else {
            "conflicted"
        };
        return Err(TxnError::RevertRefused {
            hunk: hunk.clone(),
            reason,
        });
    }
    let items = vec![ReviewItem {
        hunk_id: hunk.clone(),
        expected_review_gen: review_gen,
    }];
    check_decision(d, action, &items)?;
    let after = review_gen
        .checked_add(1)
        .ok_or_else(|| TxnError::ReviewStateExhausted { hunk: hunk.clone() })?;
    let head = p.head(doc);
    Ok(DecidedRecord {
        record: Record::ReviewDecision {
            doc,
            expected_head: head,
            action,
            items,
        },
        hunk: hunk.clone(),
        action,
        head,
        review_gen: after,
    })
}
