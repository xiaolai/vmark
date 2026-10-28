//! The identity index's value types: what a path key maps to, what opening
//! the index found, and why an index operation failed.
//!
//! A child module of `doc_index` (split for size).
//!
//! @module agent_journal/doc_index_types

use serde::{Deserialize, Serialize};

use crate::agent_journal::{doc_key::FileId, ids::DocId};

/// What a path key maps to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexEntry {
    pub doc: DocId,
    /// The canonical path, unfolded, so the file can be checked again.
    pub path: String,
    /// The file identity last recorded by VMark itself.
    pub file_id: Option<FileId>,
    /// Keyed while the file (or a folder above it) was missing: the key
    /// keeps the asked spelling, and is reconciled with the stored one once
    /// the file exists.
    pub provisional: bool,
}

/// What opening found.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct IndexOpen {
    pub repaired_tail_bytes: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("identity index I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("identity index line {line} is unreadable: {reason}")]
    Corrupt { line: usize, reason: String },
    #[error("identity index refuses appends after a write it could not roll back")]
    Poisoned,
    #[error(
        "Document identity index normalization version {found} is incompatible with this \
         build’s version {expected}. Journal recording is disabled; the index has not \
         been modified."
    )]
    Incompatible { found: String, expected: String },
}
