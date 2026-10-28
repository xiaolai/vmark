//! The comment projection: every retained thread, its state, `commentGen`,
//! reply count and charged bytes, with the logical and physical totals.
//!
//! One `plan` serves the live writer and replay. Live, it is given the
//! caps and its refusals are typed (`STALE_COMMENT`, `COMMENT_NOT_ALLOWED`,
//! `COMMENT_STATE_EXHAUSTED`, `COMMENT_LIMIT`, `COMMENT_STORAGE_FULL`);
//! on replay it runs without caps and any refusal means the journal is
//! corrupt. The state table, the generation check, the creation binding
//! (the revision exists, of the same document, with exactly the text hash
//! the record names) and overflow hold on both paths, so a journal cannot
//! carry a transition the writer would refuse.
//!
//! A document's usage entry exists only while it has a charged undeleted
//! thread, so a book with its deleted threads pruned (`prune`) equals the
//! replay of the journal the startup compaction rewrites.
//!
//! @module agent_journal/comment/book

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use crate::agent_journal::comment::bounds::{
    self, check_count, Limits, MAX_COMMENTS_PER_DOC, MAX_DELETE_FRAME, MAX_REPLIES,
    MAX_RESOLVE_FRAME,
};
use crate::agent_journal::comment::ids::{CommentId, ThreadState};
use crate::agent_journal::comment::records::{CommentCreated, CommentRecord};
use crate::agent_journal::comment::rules::{state_action, terminal, Action};
use crate::agent_journal::comment::text::{record_text, ThreadText};
use crate::agent_journal::comment::thread::{act, overflow};
pub use crate::agent_journal::comment::thread::{DocUsage, Thread};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::projection::RevisionMeta;
use crate::agent_journal::record::Envelope;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommentBook {
    pub threads: BTreeMap<CommentId, Thread>,
    /// Logical usage of each document's undeleted threads.
    pub docs: BTreeMap<DocId, DocUsage>,
    pub logical: u64,
    pub physical: u64,
    /// What each undeleted thread says (`comment::text`).
    pub texts: BTreeMap<CommentId, Arc<ThreadText>>,
}

/// A checked mutation: the thread and totals it leaves.
#[derive(Debug, Clone)]
pub struct Step {
    id: CommentId,
    thread: Thread,
    usage: DocUsage,
    logical: u64,
    physical: u64,
}

impl CommentBook {
    /// The undeleted thread `comment` of `doc` at `expected` generation.
    pub fn thread_at(
        &self,
        comment: CommentId,
        doc: DocId,
        expected: u64,
    ) -> Result<&Thread, TxnError> {
        let stale = |detail: &str| TxnError::StaleComment {
            comment,
            detail: detail.into(),
        };
        let t = self
            .threads
            .get(&comment)
            .ok_or_else(|| TxnError::InvalidRequest(format!("no comment {comment}")))?;
        if t.deleted {
            return Err(stale("the thread is deleted"));
        }
        if t.doc != doc {
            return Err(TxnError::InvalidRequest(format!(
                "comment {comment} belongs to another document"
            )));
        }
        if t.comment_gen != expected {
            return Err(stale(&format!(
                "commentGen is {}, not {expected}",
                t.comment_gen
            )));
        }
        Ok(t)
    }

    /// Check `env`'s comment record against the book. See the module docs.
    pub fn plan(
        &self,
        env: &Envelope,
        rec: CommentRecord<'_>,
        revisions: &BTreeMap<RevisionId, RevisionMeta>,
        limits: Option<&Limits>,
    ) -> Result<Step, TxnError> {
        let charge = bounds::charge(env);
        let (before, mut after, action) = self.transition(rec, revisions)?;
        after.charges = after.charges.checked_add(charge).ok_or_else(overflow)?;
        if charge > terminal_reserve(action) {
            return Err(TxnError::Invariant(format!(
                "a {charge}-byte terminal record exceeds its reserve"
            )));
        }
        let step = self.totals(rec.comment(), before, after)?;
        if let Some(l) = limits {
            check_live(&step, action, l)?;
        }
        Ok(step)
    }

    /// The thread `rec` acts on (none for a create), the thread it leaves
    /// before its charge, and its action (none for a create).
    fn transition(
        &self,
        rec: CommentRecord<'_>,
        revisions: &BTreeMap<RevisionId, RevisionMeta>,
    ) -> Result<(Option<&Thread>, Thread, Option<Action>), TxnError> {
        match rec {
            CommentRecord::Created(c) => Ok((None, self.created(c, revisions)?, None)),
            CommentRecord::Replied(r) => {
                let t = self.thread_at(r.comment, r.doc, r.expected_comment_gen)?;
                let mut after = act(r.comment, t, Action::Reply, r.caller, None)?;
                after.replies += 1;
                Ok((Some(t), after, Some(Action::Reply)))
            }
            CommentRecord::State(s) => {
                let t = self.thread_at(s.comment, s.doc, s.expected_comment_gen)?;
                let action = state_action(s.from, s.to)
                    .filter(|_| s.from == t.state)
                    .ok_or_else(|| {
                        TxnError::Corrupt("not a transition from the thread's state".into())
                    })?;
                let after = act(s.comment, t, action, s.caller, Some(s.to))?;
                Ok((Some(t), after, Some(action)))
            }
            CommentRecord::Deleted(d) => {
                let t = self.thread_at(d.comment, d.doc, d.expected_comment_gen)?;
                let after = act(d.comment, t, Action::Delete, d.caller, None)?;
                Ok((Some(t), after, Some(Action::Delete)))
            }
        }
    }

    fn created(
        &self,
        c: &CommentCreated,
        revisions: &BTreeMap<RevisionId, RevisionMeta>,
    ) -> Result<Thread, TxnError> {
        if self.threads.contains_key(&c.comment) {
            return Err(TxnError::Corrupt(format!("{} is minted twice", c.comment)));
        }
        let bound = revisions
            .get(&c.revision)
            .is_some_and(|m| m.doc == c.doc && m.postimage == c.text_hash);
        if !bound {
            return Err(TxnError::Corrupt(format!(
                "{} names a revision whose text it was not created on",
                c.comment
            )));
        }
        Ok(Thread {
            doc: c.doc,
            revision: c.revision,
            state: ThreadState::Open,
            comment_gen: 0,
            replies: 0,
            charges: 0,
            deleted: false,
        })
    }

    fn totals(
        &self,
        id: CommentId,
        before: Option<&Thread>,
        thread: Thread,
    ) -> Result<Step, TxnError> {
        let (bl, bp) = before.map_or((0, 0), |t| (t.logical(), t.physical()));
        let shift = |total: u64, old: u64, new: u64| {
            total
                .checked_sub(old)
                .and_then(|t| t.checked_add(new))
                .ok_or_else(overflow)
        };
        let mut usage = self.docs.get(&thread.doc).copied().unwrap_or_default();
        usage.bytes = shift(usage.bytes, bl, thread.logical())?;
        let live = |t: Option<&Thread>| u64::from(t.is_some_and(|t| !t.deleted));
        usage.comments = shift(usage.comments, live(before), live(Some(&thread)))?;
        Ok(Step {
            id,
            logical: shift(self.logical, bl, thread.logical())?,
            physical: shift(self.physical, bp, thread.physical())?,
            usage,
            thread,
        })
    }

    /// Make a planned step live.
    pub fn commit(&mut self, step: Step) {
        if step.usage == DocUsage::default() {
            self.docs.remove(&step.thread.doc);
        } else {
            self.docs.insert(step.thread.doc, step.usage);
        }
        self.logical = step.logical;
        self.physical = step.physical;
        self.threads.insert(step.id, step.thread);
    }

    /// Replay `env`'s comment record: any refusal is corruption.
    pub fn apply(
        &mut self,
        env: &Envelope,
        revisions: &BTreeMap<RevisionId, RevisionMeta>,
    ) -> Result<(), TxnError> {
        let Some(rec) = CommentRecord::of(&env.record) else {
            return Ok(());
        };
        let step = self.plan(env, rec, revisions, None).map_err(|e| match e {
            TxnError::Corrupt(_) => e,
            other => TxnError::Corrupt(format!("seq {}: {other}", env.seq)),
        })?;
        self.commit(step);
        record_text(&mut self.texts, rec);
        Ok(())
    }

    /// The deleted threads a startup compaction drops.
    pub fn deleted(&self) -> BTreeSet<CommentId> {
        self.threads
            .iter()
            .filter(|(_, t)| t.deleted)
            .map(|(id, _)| *id)
            .collect()
    }

    /// The book once the records of the deleted threads `gone` (from
    /// `deleted`) are compacted away.
    ///
    /// # Errors
    /// `Corrupt` when `gone` holds more physical bytes than the book
    /// counts; the book is then unchanged.
    pub fn prune(&mut self, gone: &BTreeSet<CommentId>) -> Result<(), TxnError> {
        let freed = gone
            .iter()
            .filter_map(|c| self.threads.get(c))
            .try_fold(0u64, |sum, t| sum.checked_add(t.physical()))
            .and_then(|freed| self.physical.checked_sub(freed))
            .ok_or_else(|| TxnError::Corrupt("pruned threads exceed physical usage".into()))?;
        self.physical = freed;
        self.threads.retain(|c, _| !gone.contains(c));
        Ok(())
    }
}

/// The most a record of `action` (none for a create) may charge: a
/// terminal record fits the reserve held for it, anything else is bounded
/// by the live limits instead.
fn terminal_reserve(action: Option<Action>) -> u64 {
    match action {
        Some(Action::Resolve) => MAX_RESOLVE_FRAME,
        Some(Action::Delete) => MAX_DELETE_FRAME,
        None | Some(Action::Reply | Action::MarkAddressed | Action::Reopen) => u64::MAX,
    }
}

/// The live writer's caps on `step`: a create counts against the
/// document's threads, a reply against the thread's replies, and every
/// record but a terminal one against the storage limits.
fn check_live(step: &Step, action: Option<Action>, l: &Limits) -> Result<(), TxnError> {
    match action {
        None => check_count("comments", step.usage.comments, MAX_COMMENTS_PER_DOC)?,
        Some(Action::Reply) => check_count("replies", step.thread.replies, MAX_REPLIES)?,
        Some(Action::MarkAddressed | Action::Resolve | Action::Reopen | Action::Delete) => {}
    }
    if action.is_some_and(terminal) {
        return Ok(());
    }
    l.check(
        step.thread.logical(),
        step.usage.bytes,
        step.logical,
        step.physical,
    )
}
