//! The history panel's document list on the `Controller`: a document's
//! revisions, newest first, with who made each one, its live hunks as the
//! writer persisted them, and those whose automatic revert a provenance
//! break has blocked.
//!
//! Key decisions:
//!   - A row carries the full `Actor` (the four principal states, the
//!     connection and the untrusted session label kept apart) and, for a
//!     save, the initiator; the window decides how to show them.
//!   - A blocked hunk names its `lastCertified` revision (where its span was
//!     last certified, display only) so the panel can highlight it there,
//!     plus the revision that blocked it and the one that made it.
//!   - Live hunks are listed one row per persisted hunk, newest revision
//!     first and in document order within it: the panel renders the
//!     writer's geometry and never regroups or re-diffs it.
//!   - The list is bounded (`HISTORY_ROWS`, newest kept) and says when it
//!     was cut; a revision a blocked hunk names rides past the cap, so its
//!     highlight is never cut off. A key the journal has never seen lists
//!     nothing and is not minted: a read never makes a document.
//!   - A hunk row carries what a review decision is checked against: its
//!     `reviewGen`, its mapped span (none once blocked) and edited-since
//!     flag; the reply names the document head the decision's CAS expects.
//!   - A controlled write's row lists the comments it said it addresses;
//!     one whose thread is deleted or gone is marked `deleted`, read under
//!     the same lock as the comment book.
//!   - Each row names its linear parent, so "restore what came before" is a
//!     restore of that revision; `degraded` says the document has a record
//!     queued that has not reached the disk yet.
//!
//! @module agent_journal/controller_doc_history

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::controller::{decode, Controller};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::ids::{HunkId, RevisionId};
use crate::agent_journal::projection::{Projection, RevisionKind};
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::review::{HunkKind, HunkState, Range, ReviewOp};
use crate::command_error::CommandError;

/// Most rows one history reply carries (the newest are kept).
pub const HISTORY_ROWS: usize = 200;

/// One revision of the document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub revision: RevisionId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub seq: u64,
    /// Unix milliseconds.
    pub at: u64,
    pub kind: RevisionKind,
    /// The linear parent; `None` is genesis (the empty document).
    pub parent: Option<RevisionId>,
    /// Who wrote the text.
    pub actor: Actor,
    /// Who asked for it to be recorded, when the journal keeps that.
    pub initiator: Option<Actor>,
    /// The MCP tool of a controlled write; `None` for a save.
    pub tool: Option<String>,
    /// A restore's revision.
    pub restore: bool,
    /// Collected by retention: its text is gone.
    pub collected: bool,
    /// The comments a controlled write said it addresses.
    pub addresses: Vec<AddressedRow>,
}

/// A comment a revision addresses, and whether its thread is gone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressedRow {
    pub comment: CommentId,
    /// Deleted, or no longer in the comment book at all.
    pub deleted: bool,
}

/// A live hunk whose automatic revert is blocked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedRow {
    pub hunk_id: HunkId,
    pub state: HunkState,
    pub reason: BreakReason,
    pub origin: String,
    /// The revision the span was last certified in, if it ever was.
    pub last_certified: Option<RevisionId>,
    /// The revision whose record first blocked it.
    pub blocked_at: Option<RevisionId>,
    /// The revision that made the hunk.
    pub target: RevisionId,
}

/// A live hunk as the writer persisted it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkRow {
    pub hunk_id: HunkId,
    pub kind: HunkKind,
    pub state: HunkState,
    /// The revision that made the hunk.
    pub target: RevisionId,
    pub base_range: Range,
    pub target_range: Range,
    /// The generation a review decision on this hunk must name.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub review_gen: u64,
    /// Where the hunk is in the head's text; may be inverted (`from > to`)
    /// when its text was deleted and re-typed. `None` once the hunk is
    /// blocked: its mapped range is then no evidence of where it is.
    pub span: Option<Range>,
    /// The span was touched by an edit since the hunk was made.
    pub edited_since: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocHistory {
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    /// The head a review decision names; `None` for genesis or a key the
    /// journal has never seen.
    pub head: Option<RevisionId>,
    pub rows: Vec<HistoryRow>,
    /// Older revisions exist beyond `rows`.
    pub truncated: bool,
    pub hunks: Vec<HunkRow>,
    pub blocked: Vec<BlockedRow>,
    /// A record of this document is queued, not yet durable.
    pub degraded: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryRequest {
    doc_key: String,
}

fn rows_of(p: &Projection, doc: DocId, blocked: &[BlockedRow]) -> (Vec<HistoryRow>, bool) {
    let mut all: Vec<_> = p.revisions.values().filter(|m| m.doc == doc).collect();
    all.sort_by_key(|m| std::cmp::Reverse(m.seq));
    let total = all.len();
    let referenced: HashSet<RevisionId> = blocked
        .iter()
        .flat_map(|b| [b.last_certified, b.blocked_at, Some(b.target)])
        .flatten()
        .collect();
    let rows: Vec<HistoryRow> = all
        .into_iter()
        .enumerate()
        .filter(|(i, m)| *i < HISTORY_ROWS || referenced.contains(&m.id))
        .map(|(_, m)| {
            let txn = p.txns.get(&m.txn);
            let initiator = txn
                .map(|t| t.initiator.clone())
                .or_else(|| p.observations.get(&m.txn).map(|o| o.initiator.clone()));
            HistoryRow {
                revision: m.id,
                seq: m.seq,
                at: m.at,
                kind: m.kind,
                parent: m.parent,
                actor: m.actor.clone(),
                initiator,
                tool: txn.map(|t| t.tool.clone()),
                restore: matches!(m.review_op, ReviewOp::Restore { .. }),
                collected: m.collected,
                addresses: m
                    .addresses
                    .iter()
                    .map(|&comment| AddressedRow {
                        comment,
                        deleted: p.comments.threads.get(&comment).is_none_or(|t| t.deleted),
                    })
                    .collect(),
            }
        })
        .collect();
    // Truncated only when some revision was actually left out: the
    // referenced revisions riding past the cap may cover every one of them.
    let truncated = rows.len() < total;
    (rows, truncated)
}

fn blocked_of(p: &Projection, doc: DocId) -> Vec<BlockedRow> {
    let Some(d) = p.docs.get(&doc) else {
        return Vec::new();
    };
    d.hunks
        .values()
        .filter(|h| h.state != HunkState::Settled)
        .filter_map(|h| {
            let block = h.span.block.as_ref()?;
            Some(BlockedRow {
                hunk_id: h.hunk.id.clone(),
                state: h.state,
                reason: block.reason,
                origin: block.origin.clone(),
                last_certified: h.span.last_certified.map(|c| c.at),
                blocked_at: h.blocked_at,
                target: h.hunk.target,
            })
        })
        .collect()
}

fn hunks_of(p: &Projection, doc: DocId) -> Vec<HunkRow> {
    let Some(d) = p.docs.get(&doc) else {
        return Vec::new();
    };
    let seq = |r: &RevisionId| p.revisions.get(r).map_or(0, |m| m.seq);
    let mut rows: Vec<HunkRow> = d
        .hunks
        .values()
        .filter(|h| h.state != HunkState::Settled)
        .map(|h| HunkRow {
            hunk_id: h.hunk.id.clone(),
            kind: h.hunk.kind,
            state: h.state,
            target: h.hunk.target,
            base_range: h.hunk.base_range,
            target_range: h.hunk.target_range,
            review_gen: h.review_gen,
            span: h.span.block.is_none().then_some(h.span.range),
            edited_since: h.span.edited_since,
        })
        .collect();
    rows.sort_by_key(|r| (std::cmp::Reverse(seq(&r.target)), r.target_range.start));
    rows
}

impl Controller {
    /// A document's history (`{docKey}`); see the module docs.
    ///
    /// # Errors
    /// An invalid payload or document key.
    pub fn history(&self, payload: &str) -> Result<DocHistory, CommandError> {
        let req: HistoryRequest = decode(payload)?;
        let doc = self.docs.find(&req.doc_key).map_err(|e| refusal(&e))?;
        let g = self.writer.lock();
        let p = &g.proj;
        let (rows, truncated, hunks, blocked, degraded) = match doc {
            Some(doc) => {
                let blocked = blocked_of(p, doc);
                let (rows, truncated) = rows_of(p, doc, &blocked);
                let degraded = g.degraded.get(&doc).is_some_and(|q| !q.is_empty());
                (rows, truncated, hunks_of(p, doc), blocked, degraded)
            }
            None => (Vec::new(), false, Vec::new(), Vec::new(), false),
        };
        Ok(DocHistory {
            generation: p.generation,
            head: doc.and_then(|d| p.head(d)),
            rows,
            truncated,
            hunks,
            blocked,
            degraded,
        })
    }
}
