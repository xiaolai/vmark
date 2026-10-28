//! The review transition matrix under the shared event names, so it
//! can be compared with `src/test/fixtures/agentJournal/transitions.json` and the TS worker.
//!
//! Every row is derived from the rules the writer enforces
//! (`decision_target`, `revert_target`, `capture_target`,
//! `transition_class`) — never a second copy of the table.
//!
//! Test-only: the golden fixture comparison is its one caller.
#![cfg(test)]

use crate::agent_journal::review::{HunkState, ReviewAction, ReviewOp};
use crate::agent_journal::review_rules::{
    capture_target, decision_target, revert_target, transition_class,
};
pub use crate::agent_journal::review_rules::{class_bound, GenClass};

/// User events, then capture events, in the fixture's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewEvent {
    Keep,
    Unkeep,
    RevertApplied,
    RevertRefused,
    RevertOfRevertApplied,
    RevertFoundBase,
    MarkHandled,
    ClearReviewed,
    Supersede,
    HumanResolve,
}

impl ReviewEvent {
    pub const ALL: [ReviewEvent; 10] = [
        Self::Keep,
        Self::Unkeep,
        Self::RevertApplied,
        Self::RevertRefused,
        Self::RevertOfRevertApplied,
        Self::RevertFoundBase,
        Self::MarkHandled,
        Self::ClearReviewed,
        Self::Supersede,
        Self::HumanResolve,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::Unkeep => "unkeep",
            Self::RevertApplied => "revertApplied",
            Self::RevertRefused => "revertRefused",
            Self::RevertOfRevertApplied => "revertOfRevertApplied",
            Self::RevertFoundBase => "revertFoundBase",
            Self::MarkHandled => "markHandled",
            Self::ClearReviewed => "clearReviewed",
            Self::Supersede => "supersede",
            Self::HumanResolve => "humanResolve",
        }
    }

    pub fn is_capture(self) -> bool {
        matches!(self, Self::Supersede | Self::HumanResolve)
    }

    /// Where the event moves a hunk in `from`, if it is legal there.
    pub fn target(self, from: HunkState) -> Option<HunkState> {
        let decide = |a| decision_target(a, from);
        match self {
            Self::Keep => decide(ReviewAction::Keep),
            Self::Unkeep => decide(ReviewAction::Unkeep),
            Self::RevertApplied => revert_target(from).filter(|&to| to == HunkState::Reverted),
            Self::RevertRefused => decide(ReviewAction::Conflicted),
            Self::RevertOfRevertApplied => {
                revert_target(from).filter(|&to| to == HunkState::Pending)
            }
            Self::RevertFoundBase => decide(ReviewAction::RevertFoundBase),
            Self::MarkHandled => decide(ReviewAction::MarkHandled),
            Self::ClearReviewed => decide(ReviewAction::ClearReviewed),
            Self::Supersede => capture_target(&ReviewOp::Review, from),
            Self::HumanResolve => capture_target(&ReviewOp::None, from),
        }
    }
}

/// The `reviewGen` class the writer holds `ev` into `to` to.
pub fn gen_class(ev: ReviewEvent, to: HunkState) -> GenClass {
    transition_class(ev.is_capture(), to)
}
