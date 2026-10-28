//! Pure review rules: admission, the transition table and the
//! reserved `reviewGen` values. Effects validation is `effects_rules`;
//! the slot limits live in `review_slots`.
//! No I/O; the writer calls these under its lock, `apply` reuses the tables.

use std::collections::BTreeSet;

use crate::agent_journal::errors::{TxnError, RETRY_AFTER_USER_REVIEW};
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, TxnId};
use crate::agent_journal::projection::{DocState, HunkEntry, Projection, TxnEntry, TxnStatus};
use crate::agent_journal::review::{HunkState, RestoreSource, ReviewAction, ReviewItem, ReviewOp};

pub use crate::agent_journal::review_slots::{
    full_slots, new_hunks_fit, AGENT_SLOT_LIMIT, RESTORE_SLOT_LIMIT,
};

/// Which reserved `reviewGen` ceiling a transition is held to
/// (`src/test/fixtures/agentJournal/transitions.json` `genBounds`; the class names are its keys).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenClass {
    /// A user transition into `kept`/`reverted`/`resolvedByHumanEdit`:
    /// allowed while gen ≤ MAX−2, so a hunk can always reach a decided state.
    IntoDecided,
    /// A user transition into `pending`/`conflicted`: gen ≤ MAX−3.
    Other,
    /// Clear reviewed: gen ≤ MAX−1, so a decided hunk can always settle.
    Clear,
    /// Capture-driven (`superseded`, `resolvedByHumanEdit`): gen ≤ MAX−2.
    /// Never a user-facing refusal — an active hunk is at most MAX−2 because
    /// entering it needed ≤ MAX−3 — so a violation is a broken invariant.
    Capture,
}

#[cfg(test)]
impl GenClass {
    /// The `genBounds` key in the shared fixture.
    pub fn name(self) -> &'static str {
        match self {
            Self::IntoDecided => "userToDecided",
            Self::Other => "userToActive",
            Self::Clear => "settle",
            Self::Capture => "capture",
        }
    }
}

/// The largest `reviewGen` at which a transition of `class` is allowed.
pub fn class_bound(class: GenClass) -> u64 {
    match class {
        GenClass::Clear => u64::MAX - 1,
        GenClass::IntoDecided | GenClass::Capture => u64::MAX - 2,
        GenClass::Other => u64::MAX - 3,
    }
}

/// The class of a transition into `to` (TS `genClass(event, to)`).
pub fn transition_class(capture: bool, to: HunkState) -> GenClass {
    match to {
        HunkState::Settled => GenClass::Clear,
        _ if capture => GenClass::Capture,
        s if s.is_decided() => GenClass::IntoDecided,
        _ => GenClass::Other,
    }
}

pub fn check_gen_ceiling(class: GenClass, gen: u64, hunk: &HunkId) -> Result<(), TxnError> {
    if gen <= class_bound(class) {
        Ok(())
    } else if class == GenClass::Capture {
        Err(TxnError::Invariant(format!(
            "capture at reviewGen {gen} on {}",
            hunk.0
        )))
    } else {
        Err(TxnError::ReviewStateExhausted { hunk: hunk.clone() })
    }
}

/// The state a review-only decision moves a hunk to, if legal from `from`.
/// A refused revert (`Conflicted`) is legal from `pending` only: re-applying
/// a `reverted` hunk that no longer applies records nothing.
pub fn decision_target(action: ReviewAction, from: HunkState) -> Option<HunkState> {
    use HunkState::*;
    match (action, from) {
        (ReviewAction::Keep, Pending | Conflicted) => Some(Kept),
        (ReviewAction::Unkeep, Kept) => Some(Pending),
        (ReviewAction::MarkHandled, Conflicted) => Some(ResolvedByHumanEdit),
        (ReviewAction::RevertFoundBase, Pending | Conflicted) => Some(ResolvedByHumanEdit),
        (ReviewAction::Conflicted, Pending) => Some(Conflicted),
        (ReviewAction::ClearReviewed, s) if s.is_decided() => Some(Settled),
        _ => None,
    }
}

/// The state a capture-driven transition of a revision with `op` moves an
/// active hunk to: agent content supersedes, a human save resolves. A
/// restore causes none: it is a `restore` barrier, so an older live hunk
/// stays live and blocked (its own decision is the user's), never
/// superseded.
pub fn capture_target(op: &ReviewOp, from: HunkState) -> Option<HunkState> {
    let to = match op {
        ReviewOp::Review => HunkState::Superseded,
        ReviewOp::None => HunkState::ResolvedByHumanEdit,
        ReviewOp::HunkRevert { .. } | ReviewOp::Restore { .. } => return None,
    };
    matches!(from, HunkState::Pending | HunkState::Conflicted).then_some(to)
}

/// `hunkRevert` toggles pending/conflicted ↔ reverted.
pub fn revert_target(from: HunkState) -> Option<HunkState> {
    match from {
        HunkState::Pending | HunkState::Conflicted => Some(HunkState::Reverted),
        HunkState::Reverted => Some(HunkState::Pending),
        _ => None,
    }
}

pub(crate) fn hunk_at<'a>(
    d: Option<&'a DocState>,
    id: &HunkId,
    gen: u64,
) -> Result<&'a HunkEntry, TxnError> {
    let h = d
        .and_then(|d| d.hunks.get(id))
        .ok_or_else(|| TxnError::stale(id, "unknown hunk"))?;
    if h.review_gen != gen {
        return Err(TxnError::stale(
            id,
            format!("reviewGen is {}, expected {gen}", h.review_gen),
        ));
    }
    Ok(h)
}

fn full(count: usize, limit: usize) -> TxnError {
    TxnError::ReviewBacklogFull {
        count,
        limit,
        retry: RETRY_AFTER_USER_REVIEW,
    }
}

/// Prepare-time checks for the op: slot admission, restore source, revert CAS.
pub fn check_prepare(p: &Projection, doc: DocId, op: &ReviewOp) -> Result<(), TxnError> {
    let d = p.docs.get(&doc);
    let n = d.map_or(0, DocState::non_settled);
    if let Some(limit) = full_slots(op, n) {
        return Err(full(n, limit));
    }
    match op {
        ReviewOp::None | ReviewOp::Review => Ok(()),
        ReviewOp::Restore { source } => match restore_text(p, doc, source) {
            Some(_) => Ok(()),
            None => Err(invalid("restore source does not exist")),
        },
        ReviewOp::HunkRevert {
            hunk_id,
            expected_review_gen,
        } => {
            let h = hunk_at(d, hunk_id, *expected_review_gen)?;
            let Some(to) = revert_target(h.state) else {
                return Err(TxnError::stale(
                    hunk_id,
                    format!("cannot revert a {:?} hunk", h.state),
                ));
            };
            check_gen_ceiling(transition_class(false, to), h.review_gen, hunk_id)
        }
    }
}

/// The text hash a restore of `doc` from `source` writes, if the source
/// is still live: a revision of `doc` not yet collected, a transaction of
/// `doc` still `uncommitted`, or an imported legacy checkpoint. The one
/// resolver prepare, commit and the restore read share.
pub(crate) fn restore_text<'a>(
    p: &'a Projection,
    doc: DocId,
    source: &RestoreSource,
) -> Option<&'a BlobHash> {
    match source {
        RestoreSource::Revision { revision } => p
            .revisions
            .get(revision)
            .filter(|m| m.doc == doc && !m.collected)
            .map(|m| &m.postimage),
        RestoreSource::UncommittedPreimage { txn } => p
            .txns
            .get(txn)
            .filter(|t| t.doc == doc && t.status == TxnStatus::Uncommitted)
            .map(|t| &t.preimage),
        RestoreSource::LegacyCheckpoint { legacy_id } => {
            p.legacy.get(legacy_id).map(|l| &l.preimage)
        }
    }
}

/// The transaction a restore from `source` must name in `resolves`.
pub(crate) fn restore_resolves(source: &RestoreSource) -> Option<TxnId> {
    match source {
        RestoreSource::UncommittedPreimage { txn } => Some(*txn),
        RestoreSource::Revision { .. } | RestoreSource::LegacyCheckpoint { .. } => None,
    }
}

/// Commit-time binding of a restore to its source: only
/// `uncommittedPreimage(T)` sets `resolves`, and it must be `resolves: T`
/// for a T of the same document that is still `uncommitted`; for every
/// source kind the restored text must be the source text.
pub fn check_restore(
    p: &Projection,
    t: &TxnEntry,
    postimage: &BlobHash,
    resolves: Option<TxnId>,
) -> Result<(), TxnError> {
    let ReviewOp::Restore { source } = &t.review_op else {
        return match resolves {
            None => Ok(()),
            Some(_) => Err(invalid(
                "only a restore of an uncommitted preimage may set resolves",
            )),
        };
    };
    let (text, required) = (restore_text(p, t.doc, source), restore_resolves(source));
    if resolves != required {
        return Err(invalid(
            "resolves must name exactly the restored uncommitted transaction",
        ));
    }
    match text {
        Some(h) if h == postimage => Ok(()),
        Some(_) => Err(invalid("restored text does not match the restore source")),
        None => Err(invalid("restore source no longer exists")),
    }
}

/// All-or-nothing validation of a review-only decision batch. Keep,
/// un-keep and mark-handled stay allowed on a blocked hunk.
pub fn check_decision(
    d: Option<&DocState>,
    action: ReviewAction,
    items: &[ReviewItem],
) -> Result<(), TxnError> {
    check_decision_gated(d, action, items, crate::agent_journal::revert_gate::gate)
}

/// [`check_decision`] with the revert-outcome gate supplied: replay
/// cannot rerun the live gate's span checks (GC drops collected spans).
pub(crate) fn check_decision_gated(
    d: Option<&DocState>,
    action: ReviewAction,
    items: &[ReviewItem],
    gate: impl Fn(&DocState, &HunkId) -> Result<(), TxnError>,
) -> Result<(), TxnError> {
    if items.is_empty() {
        return Err(TxnError::InvalidRequest(
            "a decision names at least one hunk".into(),
        ));
    }
    let mut seen = BTreeSet::new();
    if !items.iter().all(|i| seen.insert(&i.hunk_id)) {
        return Err(TxnError::InvalidRequest(
            "duplicate hunk in a decision".into(),
        ));
    }
    for item in items {
        let h = hunk_at(d, &item.hunk_id, item.expected_review_gen)?;
        let Some(to) = decision_target(action, h.state) else {
            return Err(TxnError::stale(
                &item.hunk_id,
                format!("{action:?} is not legal from {:?}", h.state),
            ));
        };
        check_gen_ceiling(transition_class(false, to), h.review_gen, &item.hunk_id)?;
        // A revert outcome is decided only on a certified span: a
        // blocked hunk is AMBIGUOUS, never conflicted or found-base.
        if matches!(
            action,
            ReviewAction::Conflicted | ReviewAction::RevertFoundBase
        ) {
            gate(d.expect("hunk_at found the document"), &item.hunk_id)?;
        }
    }
    Ok(())
}

pub(crate) fn invalid(msg: &str) -> TxnError {
    TxnError::InvalidRequest(msg.into())
}
