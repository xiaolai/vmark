//! Hands a batch's rename paths to the agent journal, which moves a
//! document's identity to the new path when the file there is the one it
//! recorded (see `agent_journal/doc_registry.rs`). A rename the OS reports as
//! one pair or as separate endpoints arrives the same way: every path, once.
//!
//! Key decisions:
//!   - Every renamed path — a file, or a directory whose tree the journal
//!     walks up to its walk bound — is followed before the batch is
//!     delivered, on the watcher's batch thread: a window that opens a
//!     renamed file, or one under a renamed directory, finds its identity
//!     already at the new path. The walk's latency is accepted; resolving
//!     first would mint a fresh document and split the history.
//!
//! Known limitations:
//!   - A file a window resolves while the batch is still being collected
//!     (before delivery) starts a fresh document, as does a file past the
//!     walk bound of a very large renamed directory.
//!
//! @coordinates-with agent_journal/service_identity.rs — `note_renames`

use std::collections::HashSet;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use super::batch::{FsChangeBatch, FsChangeKind};

/// Every path a rename in `batch` names, in order, each once.
pub(super) fn rename_paths(batch: &FsChangeBatch) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    batch
        .changes
        .iter()
        .filter(|c| c.kind == FsChangeKind::Rename)
        .flat_map(|c| c.paths.iter())
        .filter(|p| seen.insert(p.as_str()))
        .map(PathBuf::from)
        .collect()
}

/// Deliver `batch` with `emit` once the journal has followed every path
/// its renames name. Runs on the watcher's batch thread, never the main
/// thread.
pub(super) fn deliver<R: Runtime>(app: &AppHandle<R>, batch: &FsChangeBatch, emit: impl FnOnce()) {
    let paths = rename_paths(batch);
    if !paths.is_empty() {
        follow(app, &paths);
    }
    emit();
}

/// Let the journal follow renames naming `paths`.
fn follow<R: Runtime>(app: &AppHandle<R>, paths: &[PathBuf]) {
    if let Some(state) = app.try_state::<crate::agent_journal::service::AgentJournalState>() {
        let moved = state.note_renames(paths);
        if moved > 0 {
            log::info!("[watcher] {moved} document identit(ies) followed an external rename");
        }
    }
}

#[cfg(test)]
#[path = "renames.test.rs"]
mod tests;
