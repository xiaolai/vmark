//! The frontend's checkpoint store on the `Controller`: the history panel's
//! checkpoints live in the journal as `legacyCheckpoint` records, not in
//! `mcp-checkpoints.jsonl` (which startup imports and retires).
//!
//! Key decisions:
//!   - Read and forget only: agent writes are journaled revisions, so the
//!     panel no longer records checkpoints. The records left are the
//!     "Earlier checkpoints" of versions before the journal.
//!   - A forget is a deletion (`Writer::forget_legacy`), so clearing the
//!     history removes the texts from disk, not just from the list.
//!   - The list carries what the record keeps: a checkpoint of a saved file
//!     is anchored on its path (its tab id is a session's, gone at restart);
//!     an untitled tab's on its tab id. Session revisions are not kept.
//!
//! @module agent_journal/controller_checkpoints

use serde::{Deserialize, Serialize};

use crate::agent_journal::controller::{decode, Controller};
use crate::agent_journal::record::LegacyAnchor;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer_checkpoints::ForgetReport;
use crate::agent_journal::writer_revert::referenced_blob;
use crate::command_error::CommandError;

/// One checkpoint, as the history panel hydrates it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointView {
    pub id: String,
    pub tab_id: Option<String>,
    pub file_path: Option<String>,
    /// Milliseconds since the epoch, as the frontend stamped it.
    pub timestamp: u64,
    pub tool: String,
    pub description: String,
    pub content_before: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForgetRequest {
    ids: Vec<String>,
}

impl Controller {
    /// Every checkpoint, in the order they were written. The records and
    /// their texts are read under one writer lock, so a concurrent forget
    /// lands wholly before or wholly after the listing.
    ///
    /// # Errors
    /// A checkpoint's text cannot be read.
    pub fn checkpoints(&self) -> Result<Vec<CheckpointView>, CommandError> {
        let mut g = self.writer.lock();
        let mut entries: Vec<_> = g
            .proj
            .legacy
            .iter()
            .map(|(id, e)| (id.clone(), e.clone()))
            .collect();
        entries.sort_by_key(|(_, e)| e.seq);
        entries
            .into_iter()
            .map(|(id, e)| {
                let content_before =
                    referenced_blob(&mut g.blobs, &e.preimage).map_err(|err| refusal(&err))?;
                let (tab_id, file_path) = match e.anchor {
                    LegacyAnchor::FilePath { path } => (None, Some(path)),
                    LegacyAnchor::Tab { tab_id } => (Some(tab_id), None),
                };
                Ok(CheckpointView {
                    id,
                    tab_id,
                    file_path,
                    timestamp: e.timestamp,
                    tool: e.tool,
                    description: e.description,
                    content_before,
                })
            })
            .collect()
    }

    /// Append one checkpoint (`payload`: the old `MCPCheckpoint` JSON).
    /// `false` when the journal already holds that id. Tests only: no
    /// command appends checkpoints any more (agent writes are journaled
    /// revisions); the import of `mcp-checkpoints.jsonl` is the one
    /// production source of these records.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed checkpoint; the writer's refusal.
    #[cfg(test)]
    pub fn checkpoint_append(&self, payload: &str) -> Result<bool, CommandError> {
        self.writer
            .append_checkpoint(payload)
            .map_err(|e| refusal(&e))
    }

    /// Delete the checkpoints named (`payload`: JSON `{ids}`); unknown ids
    /// are ignored.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload; the writer's refusal.
    pub fn checkpoints_forget(&self, payload: &str) -> Result<ForgetReport, CommandError> {
        let req: ForgetRequest = decode(payload)?;
        self.writer.forget_legacy(&req.ids).map_err(|e| refusal(&e))
    }
}
