//! Finder/CLI file-open decision state: the queue's owner, the pending queue,
//! workspace grouping, and the atomic queue-vs-emit decision.
//!
//! Key decision: file opens from Finder are grouped by workspace root so
//! multiple files in the same directory open as tabs in a single window.
//!
//! Key decision: "queue and wait" is tied to the LIFE of the window that will
//! drain the queue ([`QueueOwner`]). Only `main` drains it, once, when its
//! frontend mounts; a bare "not ready yet" flag kept saying "wait" after that
//! window had been destroyed, and every later open was queued behind a window
//! that no longer existed.

use std::collections::HashMap;
use std::path::Path;

use crate::{quit::is_document_window_label, PendingFileOpen};

/// The window that owns the cold-start queue — see `document_windows`.
const QUEUE_OWNER_LABEL: &str = "main";

/// Where the cold-start queue's owner is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueOwner {
    /// A `main` window is up, or being built, and has not drained the queue
    /// yet: queued opens will be picked up when its frontend mounts.
    Booting,
    /// Nothing is on its way to drain the queue: `main` has drained it, or
    /// `main` is gone. An open is emitted to a listening window, or brings a
    /// new `main` up.
    Settled,
}

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
    /// A listening document window exists — emit directly
    EmitToDocumentWindow,
    /// No listening document window, and none booting — queue and create one
    QueueAndCreateWindow,
    /// A `main` window is booting (cold start) — just queue files for it
    QueueOnly,
}

/// Decide how to handle file opens based on app state.
pub fn determine_file_open_action(owner: QueueOwner, has_document_window: bool) -> FileOpenAction {
    match (owner, has_document_window) {
        (QueueOwner::Settled, true) => FileOpenAction::EmitToDocumentWindow,
        (QueueOwner::Settled, false) => FileOpenAction::QueueAndCreateWindow,
        (QueueOwner::Booting, _) => FileOpenAction::QueueOnly,
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

/// Combined Finder file-open state, guarded by a single mutex
/// (`FileOpenStore`).
///
/// Keeping the owner's state and the pending queue together lets the
/// readiness *check* and the queue *insertion* happen in one critical
/// section. That closes the TOCTOU where
/// `get_pending_file_opens` settles the owner and drains the queue
/// between an emit-side check and its queue insertion — which could otherwise
/// drop or double-deliver a Finder open. Mirrors the single-lock discipline of
/// `menu::events::check_ready_or_queue`.
pub struct FileOpenState {
    pub owner: QueueOwner,
    pub pending: Vec<PendingFileOpen>,
    last_focused_document_window: Option<String>,
    ready_document_windows: Vec<String>,
}

impl FileOpenState {
    /// The state at launch: Tauri builds `main` from the config, so the
    /// queue's owner is booting.
    pub const fn new() -> Self {
        Self {
            owner: QueueOwner::Booting,
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

    /// The most recently focused, listener-ready document window, if it is
    /// still open. MCP routing falls back to it when no VMark window holds
    /// focus — the user is typing in their AI client — so a request without
    /// a tab lands in the window the user last worked in, not in `main`.
    pub fn last_focused_document_window(&self) -> Option<&str> {
        self.last_focused_document_window.as_deref()
    }

    /// Remove a destroyed window from the focus history. When it was the
    /// queue's owner, nothing is booting any more: the next open must bring a
    /// new `main` up rather than wait for this one.
    pub fn remove_window(&mut self, label: &str) {
        self.ready_document_windows.retain(|ready| ready != label);
        if self.last_focused_document_window.as_deref() == Some(label) {
            self.last_focused_document_window = None;
        }
        if label == QUEUE_OWNER_LABEL {
            self.owner = QueueOwner::Settled;
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
    match determine_file_open_action(state.owner, has_document_window) {
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
            // The new main window does not have a frontend listener yet. Mark
            // it booting before releasing the lock so rapid follow-up opens join
            // the same cold-start queue instead of being emitted too early.
            state.owner = QueueOwner::Booting;
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

/// Settle the queue's owner and drain the pending queue in one critical
/// section (caller passes the locked state). Returns the drained opens.
///
/// `drained_by` is the window that asked. Its frontend registers its
/// `app:open-file` listener before it drains, so from here on it can take a
/// hot open — it is recorded as listening now, rather than when its separate
/// `ready` event arrives. Without that, an open landing between the two found
/// no target, was queued for a window that had already drained, and stayed
/// queued.
pub fn mark_ready_and_drain(state: &mut FileOpenState, drained_by: &str) -> Vec<PendingFileOpen> {
    state.owner = QueueOwner::Settled;
    state.record_window_focus(drained_by, false, true);
    // `take`, not `drain(..).collect()`: draining every element into a fresh
    // Vec of the same type allocates a second buffer and copies into it, when
    // the existing buffer can simply be handed over (`clippy::drain_collect`).
    std::mem::take(&mut state.pending)
}

/// Queue the openable files a cold launch was handed on its command line
/// (Windows/Linux: an Explorer double-click starts `vmark <path>`), so the
/// first window's frontend drains them once it mounts.
///
/// Takes the mutex rather than a guard so the poison rule lives here, beside
/// the queueing: a panic elsewhere while the state was locked must not cost
/// the user the file they launched the app to open.
///
/// Compiled where it runs — macOS receives its opens as `RunEvent::Opened`,
/// never as argv — and in the tests.
#[cfg(any(not(target_os = "macos"), test))]
pub fn queue_launch_file_args(state: &std::sync::Mutex<FileOpenState>, file_args: Vec<String>) {
    if file_args.is_empty() {
        return;
    }
    let mut state = state.lock().unwrap_or_else(|p| p.into_inner());
    for path in file_args {
        let workspace_root = get_workspace_root_for_file(&path);
        state.pending.push(PendingFileOpen {
            path,
            workspace_root,
        });
    }
}

#[cfg(test)]
#[path = "file_open_state.test.rs"]
mod tests;
