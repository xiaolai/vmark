//! Static shape of an `admission` frame, checked at decode and again on
//! staging: at least two child envelopes; `seq` contiguous from the outer
//! envelope's; one shared `at`; one schema, v3 to v5, on the frame and
//! every item; one document; no nesting; only the kinds a
//! multi-record write produces: observations and their linearizations,
//! then exactly one outcome, last — a `prepared`, a review decision, or a
//! `commentCreated` on the text the frame just linearized; at most one
//! receipt, on the last item;
//! and the outer `txn` is that last item's. A linearization names no
//! document, so its document is checked when the frame is reduced.
//!
//! @module agent_journal/admission/shape

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V3, SCHEMA_V5};

/// Every rule above, on a decoded or staged `admission` envelope. Other
/// kinds pass untouched.
pub fn check(env: &Envelope) -> Result<(), TxnError> {
    let Record::Admission { items } = &env.record else {
        return Ok(());
    };
    let bad = |why: &str| TxnError::Corrupt(format!("seq {}: admission {why}", env.seq));
    if env.receipt.is_some() {
        return Err(bad("carries a receipt on the frame itself"));
    }
    if items.len() < 2 {
        return Err(bad("has fewer than two items"));
    }
    let mut doc: Option<DocId> = None;
    for (i, item) in items.iter().enumerate() {
        let want = u64::try_from(i)
            .ok()
            .and_then(|i| env.seq.checked_add(i))
            .ok_or_else(|| bad("item seq overflows"))?;
        if item.seq != want {
            return Err(bad("items are not contiguous from the frame's seq"));
        }
        if item.at != env.at {
            return Err(bad("items carry more than one `at`"));
        }
        if item.schema_version != env.schema_version
            || !(SCHEMA_V3..=SCHEMA_V5).contains(&env.schema_version)
        {
            return Err(bad("is not one schema, v3 to v5, throughout"));
        }
        let last = i + 1 == items.len();
        if matches!(item.record, Record::CommentCreated(_)) && !last {
            return Err(bad("carries a commentCreated before its last item"));
        }
        if is_outcome(&item.record) != last {
            return Err(bad("does not end in exactly one outcome"));
        }
        if item.receipt.is_some() && i + 1 != items.len() {
            return Err(bad("carries a receipt before its last item"));
        }
        if let Some(named) = item_doc(&item.record).map_err(bad)? {
            if doc.is_some_and(|d| d != named) {
                return Err(bad("names more than one document"));
            }
            doc = Some(named);
        }
    }
    if items.last().map(|e| e.txn) != Some(env.txn) {
        return Err(bad("txn is not its last item's"));
    }
    Ok(())
}

/// A `prepared`, review decision or `commentCreated`: what the frame
/// admits, after the observations and linearizations it needed.
fn is_outcome(record: &Record) -> bool {
    matches!(
        record,
        Record::Prepared { .. } | Record::ReviewDecision { .. } | Record::CommentCreated(_)
    )
}

/// The document an item names, `None` for a linearization; a kind an
/// admission never carries is refused with its reason.
fn item_doc(record: &Record) -> Result<Option<DocId>, &'static str> {
    match record {
        Record::PendingObservation { doc, .. }
        | Record::Prepared { doc, .. }
        | Record::ReviewDecision { doc, .. } => Ok(Some(*doc)),
        Record::CommentCreated(c) => Ok(Some(c.doc)),
        Record::ObservedRevision { .. }
        | Record::ConcurrentObservation { .. }
        | Record::Gap { .. } => Ok(None),
        Record::Admission { .. } => Err("is nested"),
        Record::JournalHeader { .. }
        | Record::Aborted { .. }
        | Record::Committed { .. }
        | Record::Uncommitted
        | Record::Discarded { .. }
        | Record::Tombstone { .. }
        | Record::EpochArmed { .. }
        | Record::EpochClosed { .. }
        | Record::EpochUnclosed { .. }
        | Record::LegacyCheckpoint { .. }
        | Record::CommentReplied(_)
        | Record::CommentState(_)
        | Record::CommentDeleted(_) => Err("carries a kind no admission writes"),
    }
}
