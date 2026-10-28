//! The ways a Git export ends without moving the branch, each with a stable
//! `exportCode` the window translates. Messages are plain English for logs;
//! the window shows its own translated sentence per code.
//!
//! @module agent_journal/git_export/error

use serde_json::json;

use crate::command_error::{CommandError, ErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportError {
    /// The `git` program could not be started.
    GitMissing,
    /// The chosen folder is not inside a Git repository.
    NotARepository(String),
    /// The document has no revisions in the journal yet.
    NoHistory,
    /// A malformed request (a relative repository path, an unknown key).
    InvalidRequest(String),
    /// The branch moved: a commit VMark did not write sits on top of the
    /// export, or another writer moved the ref during this export.
    Conflict(String),
    /// The branch exists but is not this document's export.
    UnrelatedBranch(String),
    /// The branch is checked out in a worktree; moving it would change
    /// what that worktree's index and files are compared against.
    BranchCheckedOut(String),
    /// Git ran and refused.
    Git(String),
    /// The journal could not supply a consistent chain or a text.
    Journal(String),
    /// Reading or writing the export state file failed at the disk. Shares
    /// `JOURNAL_ERROR` with `Journal` for the window, but is an I/O class.
    StateIo(String),
}

impl ExportError {
    /// The wire code in `detail.exportCode`.
    pub fn code(&self) -> &'static str {
        match self {
            ExportError::GitMissing => "GIT_MISSING",
            ExportError::NotARepository(_) => "NOT_A_REPOSITORY",
            ExportError::NoHistory => "NO_HISTORY",
            ExportError::InvalidRequest(_) => "INVALID_REQUEST",
            ExportError::Conflict(_) => "EXPORT_CONFLICT",
            ExportError::UnrelatedBranch(_) => "UNRELATED_BRANCH",
            ExportError::BranchCheckedOut(_) => "BRANCH_CHECKED_OUT",
            ExportError::Git(_) => "GIT_FAILED",
            ExportError::Journal(_) | ExportError::StateIo(_) => "JOURNAL_ERROR",
        }
    }

    fn class(&self) -> ErrorCode {
        match self {
            ExportError::GitMissing => ErrorCode::Unsupported,
            ExportError::NotARepository(_)
            | ExportError::InvalidRequest(_)
            | ExportError::NoHistory => ErrorCode::InvalidInput,
            ExportError::Conflict(_)
            | ExportError::UnrelatedBranch(_)
            | ExportError::BranchCheckedOut(_) => ErrorCode::Conflict,
            ExportError::Git(_) | ExportError::StateIo(_) => ErrorCode::Io,
            ExportError::Journal(_) => ErrorCode::Internal,
        }
    }
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::GitMissing => write!(
                f,
                "Git is not installed or not on PATH; install Git to export the edit history"
            ),
            ExportError::NotARepository(m) => write!(f, "not a Git repository: {m}"),
            ExportError::NoHistory => write!(f, "the document has no edit history to export yet"),
            ExportError::InvalidRequest(m) => write!(f, "invalid export request: {m}"),
            ExportError::Conflict(m) => write!(f, "export branch changed outside VMark: {m}"),
            ExportError::UnrelatedBranch(m) => {
                write!(f, "refusing to export into an unrelated branch: {m}")
            }
            ExportError::BranchCheckedOut(m) => {
                write!(f, "the export branch is checked out in a worktree: {m}")
            }
            ExportError::Git(m) => write!(f, "git failed: {m}"),
            ExportError::Journal(m) => write!(f, "journal cannot be exported: {m}"),
            ExportError::StateIo(m) => write!(f, "export state {m}"),
        }
    }
}

impl From<ExportError> for CommandError {
    fn from(e: ExportError) -> Self {
        CommandError::new(e.class(), e.to_string()).with_detail(json!({ "exportCode": e.code() }))
    }
}
