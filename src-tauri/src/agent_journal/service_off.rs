//! Why the journal is off for the session, kept typed.
//!
//! A failed start leaves no writer. Most failures only need their
//! `CODE: message` for the status line, and every command then refuses with
//! `JOURNAL_UNAVAILABLE`. A journal written by a newer build is different:
//! the status marks it read-only (written by a newer build) and every
//! journal command refuses with `JOURNAL_FUTURE_FORMAT`, so a caller can
//! tell "this build cannot read the history" from "the journal is not
//! running". No partially replayed history is kept for it.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::refusal::{refusal, unavailable};
use crate::command_error::CommandError;

use super::AgentJournalState;

/// A start that left the journal off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartFailure {
    /// `CODE: message`, as the status reports it.
    message: String,
    /// The unreadable schema version, when a newer build wrote the journal.
    future: Option<u32>,
}

impl StartFailure {
    /// The writer's refusal to open, with its code.
    pub(super) fn open(e: &TxnError) -> Self {
        let future = match e {
            TxnError::FutureFormat { version } => Some(*version),
            _ => None,
        };
        StartFailure {
            message: format!("{}: {e}", e.code()),
            future,
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// Whether a newer build wrote the journal.
    pub fn is_future_format(&self) -> bool {
        self.future.is_some()
    }
}

/// Any other failure, already written as `CODE: message`.
impl From<String> for StartFailure {
    fn from(message: String) -> Self {
        StartFailure {
            message,
            future: None,
        }
    }
}

impl std::fmt::Display for StartFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl AgentJournalState {
    /// The refusal for a command that finds no journal: `JOURNAL_FUTURE_FORMAT`
    /// when a newer build wrote it, otherwise `JOURNAL_UNAVAILABLE` (still
    /// starting, or failed for another reason).
    pub fn off_refusal(&self) -> CommandError {
        match self.outcome.get() {
            Some(Err(StartFailure {
                future: Some(version),
                ..
            })) => refusal(&TxnError::FutureFormat { version: *version }),
            _ => unavailable(),
        }
    }
}
