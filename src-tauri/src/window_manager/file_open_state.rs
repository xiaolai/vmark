//! Finder/CLI file-open decision state: readiness flag, pending queue,
//! workspace grouping, and the atomic queue-vs-emit decision.
//!
//! Key decision: file opens from Finder are grouped by workspace root so
//! multiple files in the same directory open as tabs in a single window.

use std::collections::HashMap;
use std::path::Path;

use crate::{quit::is_document_window_label, PendingFileOpen};

/// Compute workspace root from a file path (parent directory).
/// Returns None if the file is at root level or path is invalid.
///
/// Root-level files (e.g., `/file.md` or `C:\file.md`) return None
/// to prevent opening the entire filesystem as a workspace.
pub fn get_workspace_root_for_file(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        // Exclude root paths (/, C:\, etc.) - they have no parent
        .filter(|p| p.parent().is_some())
        .map(|p| p.to_string_lossy().to_string())
}

/// What to do when files are opened from the system (Finder, CLI, etc.)
#[derive(Debug, PartialEq)]
pub enum FileOpenAction {
    /// Frontend is ready and a document window exists — emit directly
    EmitToDocumentWindow,
    /// Frontend is ready but no document window exists — queue and create one
    QueueAndCreateWindow,
    /// Frontend not ready (cold start) — just queue files
    QueueOnly,
}

/// Decide how to handle file opens based on app state.
pub fn determine_file_open_action(
    frontend_ready: bool,
    has_document_window: bool,
) -> FileOpenAction {
    match (frontend_ready, has_document_window) {
        (true, true) => FileOpenAction::EmitToDocumentWindow,
        (true, false) => FileOpenAction::QueueAndCreateWindow,
        (false, _) => FileOpenAction::QueueOnly,
    }
}

/// Group file paths by their workspace root.
///
/// Returns a map from workspace root (or empty string for root-level files)
/// to the list of file paths in that workspace.
pub fn group_paths_by_workspace(paths: &[String]) -> HashMap<String, Vec<String>> {
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for path in paths {
        let key = get_workspace_root_for_file(path).unwrap_or_default();
        groups.entry(key).or_default().push(path.clone());
    }
    groups
}

/// Append files to the pending queue with a shared workspace root.
pub fn queue_pending_file_opens(
    pending: &mut Vec<PendingFileOpen>,
    file_paths: Vec<String>,
    workspace_root: Option<&str>,
) {
    for path in file_paths {
        pending.push(PendingFileOpen {
            path,
            workspace_root: workspace_root.map(String::from),
        });
    }
}

/// Combined Finder file-open state, guarded by a single mutex in `file_open.rs`.
///
/// Keeping the readiness flag and the pending queue together lets the
/// readiness *check* and the queue *insertion* happen in one critical
/// section. That closes the TOCTOU (WI-0.8, C3) where
/// `get_pending_file_opens` flips `frontend_ready` and drains the queue
/// between an emit-side check and its queue insertion — which could otherwise
/// drop or double-deliver a Finder open. Mirrors the single-lock discipline of
/// `menu_events::check_ready_or_queue`.
pub struct FileOpenState {
    pub frontend_ready: bool,
    pub pending: Vec<PendingFileOpen>,
    last_focused_document_window: Option<String>,
    ready_document_windows: Vec<String>,
}

impl FileOpenState {
    pub const fn new() -> Self {
        Self {
            frontend_ready: false,
            pending: Vec::new(),
            last_focused_document_window: None,
            ready_document_windows: Vec::new(),
        }
    }

    /// Remember the most recently focused, listener-ready document window. A
    /// `Focused(false)` event means focus moved to Finder or another app, so it
    /// must not erase the destination Finder should restore on the next open.
    pub fn record_window_focus(&mut self, label: &str, focused: bool, listener_ready: bool) {
        if !is_document_window_label(label) {
            return;
        }
        if listener_ready
            && !self
                .ready_document_windows
                .iter()
                .any(|ready| ready == label)
        {
            self.ready_document_windows.push(label.to_string());
        }
        if focused && listener_ready {
            self.last_focused_document_window = Some(label.to_string());
        }
    }

    /// Remove a destroyed window from the focus history.
    pub fn remove_window(&mut self, label: &str) {
        self.ready_document_windows.retain(|ready| ready != label);
        if self.last_focused_document_window.as_deref() == Some(label) {
            self.last_focused_document_window = None;
        }
    }

    /// Select a live document window for a Finder hot-open.
    ///
    /// Prefer the last focused document, then `main`, then the first label in
    /// sorted order so the fallback is deterministic across HashMap runs.
    pub fn finder_window_target(&self, live_labels: &[String]) -> Option<String> {
        let mut document_labels: Vec<&str> = live_labels
            .iter()
            .map(String::as_str)
            .filter(|label| {
                is_document_window_label(label)
                    && self
                        .ready_document_windows
                        .iter()
                        .any(|ready| ready == *label)
            })
            .collect();

        if let Some(preferred) = self.last_focused_document_window.as_deref() {
            if document_labels.contains(&preferred) {
                return Some(preferred.to_string());
            }
        }
        if document_labels.contains(&"main") {
            return Some("main".to_string());
        }

        document_labels.sort_unstable();
        document_labels.first().map(|label| (*label).to_string())
    }
}

impl Default for FileOpenState {
    fn default() -> Self {
        Self::new()
    }
}

/// Outcome of an atomic file-open decision. The caller performs the side
/// effects (emit / create window) OUTSIDE the lock.
pub enum FileOpenOutcome {
    /// Frontend is ready — emit these payloads to the selected document window.
    Emit(Vec<PendingFileOpen>),
    /// Files were queued; if `create_window`, the caller must create a main
    /// window so the queue gets drained once React mounts.
    Queued { create_window: bool },
}

/// Decide what to do with a batch of opens and queue them if needed — all
/// while the caller holds the `FileOpenState` lock. Pure over the passed
/// state, so it is unit-testable without the global mutex.
pub fn decide_file_open_locked(
    state: &mut FileOpenState,
    has_document_window: bool,
    paths: Vec<String>,
    workspace_root: Option<&str>,
) -> FileOpenOutcome {
    match determine_file_open_action(state.frontend_ready, has_document_window) {
        FileOpenAction::EmitToDocumentWindow => {
            let payloads = paths
                .into_iter()
                .map(|path| PendingFileOpen {
                    path,
                    workspace_root: workspace_root.map(String::from),
                })
                .collect();
            FileOpenOutcome::Emit(payloads)
        }
        FileOpenAction::QueueAndCreateWindow => {
            // The new main window does not have a frontend listener yet. Reset
            // readiness before releasing the lock so rapid follow-up opens join
            // the same cold-start queue instead of being emitted too early.
            state.frontend_ready = false;
            queue_pending_file_opens(&mut state.pending, paths, workspace_root);
            FileOpenOutcome::Queued {
                create_window: true,
            }
        }
        FileOpenAction::QueueOnly => {
            queue_pending_file_opens(&mut state.pending, paths, workspace_root);
            FileOpenOutcome::Queued {
                create_window: false,
            }
        }
    }
}

/// Mark the frontend ready and drain the pending queue in one critical
/// section (caller passes the locked state). Returns the drained opens.
pub fn mark_ready_and_drain(state: &mut FileOpenState) -> Vec<PendingFileOpen> {
    state.frontend_ready = true;
    state.pending.drain(..).collect()
}

#[cfg(test)]
#[path = "file_open_state.test.rs"]
mod tests;
