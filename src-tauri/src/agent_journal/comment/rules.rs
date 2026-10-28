//! The thread state machine: which caller may take which action from which
//! state, and when `commentGen` is too close to `u64::MAX` for an action.
//!
//! | Action | User | Agent |
//! |---|---|---|
//! | reply | every state, no state change | every state but `resolved` |
//! | markAddressed | `open`/`reopened` → `addressed` | the same |
//! | resolve | `open`/`addressed`/`reopened` → `resolved` | never |
//! | reopen | `resolved` → `reopened` | never |
//! | delete | from `resolved` | never |
//!
//! Every other cell is refused before anything is appended. Replay holds
//! each `commentState` record to the same table, so a journal cannot carry
//! a transition the writer would refuse.
//!
//! Exhaustion: non-terminal actions are refused once `commentGen` reaches
//! `MAX − 2`; `resolve` is allowed through `MAX − 2` (it leaves `MAX − 1`),
//! and `delete`, which does not bump, at any generation. So a thread can
//! always end, and no generation wraps.
//!
//! @module agent_journal/comment/rules

use crate::agent_journal::comment::ids::{CommentCaller, ThreadState};

/// What a call asks of a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Action {
    Reply,
    MarkAddressed,
    Resolve,
    Reopen,
    Delete,
}

impl Action {
    pub const ALL: [Self; 5] = [
        Self::Reply,
        Self::MarkAddressed,
        Self::Resolve,
        Self::Reopen,
        Self::Delete,
    ];

    /// The wire name, as refusals report it.
    pub fn name(self) -> &'static str {
        match self {
            Self::Reply => "reply",
            Self::MarkAddressed => "markAddressed",
            Self::Resolve => "resolve",
            Self::Reopen => "reopen",
            Self::Delete => "delete",
        }
    }
}

/// Whether `caller` may take `action` from `from`: the state it leaves the
/// thread in (`from` itself for a reply and a delete), or `None`.
pub fn allowed(action: Action, caller: CommentCaller, from: ThreadState) -> Option<ThreadState> {
    use CommentCaller::{Agent, User};
    use ThreadState::{Addressed, Open, Reopened, Resolved};
    match (action, caller, from) {
        (Action::Reply, User, s) => Some(s),
        (Action::Reply, Agent, Resolved) => None,
        (Action::Reply, Agent, s) => Some(s),
        (Action::MarkAddressed, _, Open | Reopened) => Some(Addressed),
        (Action::MarkAddressed, _, Addressed | Resolved) => None,
        (Action::Resolve, User, Open | Addressed | Reopened) => Some(Resolved),
        (Action::Reopen, User, Resolved) => Some(Reopened),
        (Action::Delete, User, Resolved) => Some(Resolved),
        (Action::Resolve | Action::Reopen | Action::Delete, _, _) => None,
    }
}

/// The state action a `commentState` record's edge is, if it is one.
pub fn state_action(from: ThreadState, to: ThreadState) -> Option<Action> {
    [Action::MarkAddressed, Action::Resolve, Action::Reopen]
        .into_iter()
        .find(|&a| {
            CommentCaller::ALL
                .iter()
                .any(|&c| allowed(a, c, from) == Some(to))
        })
}

/// Whether `action` is refused at `comment_gen` (see the module docs).
pub fn exhausted(action: Action, comment_gen: u64) -> bool {
    match action {
        Action::Delete => false,
        Action::Resolve => comment_gen > u64::MAX - 2,
        Action::Reply | Action::MarkAddressed | Action::Reopen => comment_gen >= u64::MAX - 2,
    }
}

/// Whether `action` consumes the terminal reserve rather than preserving it.
pub fn terminal(action: Action) -> bool {
    matches!(action, Action::Resolve | Action::Delete)
}
