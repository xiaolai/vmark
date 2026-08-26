//! Finder/CLI file-open queueing and macOS reopen.
//!
//! Purpose: Owns cold-start file-open queueing, hot-open document-window
//! delivery, and the macOS `RunEvent::Opened` / `RunEvent::Reopen` handlers.
//!
//! fs-scope extension used to live here too and now lives in `fs_scope.rs` —
//! this file consumes it (`crate::allow_fs_read`) rather than owning it. It
//! moved when adding the recursive workspace grant (#1252) pushed this file
//! over the 300-line limit, which the size gate correctly refused.
//!
//! Key decisions:
//!   - File opens from Finder are queued in `FILE_OPEN_STATE` until the frontend
//!     signals readiness, solving a cold-start race condition. Only files with a
//!     registered extension are accepted; others are skipped. Hot opens (app
//!     already running) target the last focused document window, attach that
//!     label to an `app.emit()` global broadcast, and bring the native window
//!     forward. Each frontend window filters the broadcast by target label.
//!   - macOS Reopen event (dock click) creates a new main window when none
//!     visible, restoring the user's most-recent workspace via
//!     `window_manager::pick_reopen_workspace_root` so closing the last tab and
//!     re-clicking the dock doesn't drop them into an orphan untitled doc.

use std::sync::Mutex;

use crate::window_manager;

#[cfg(target_os = "macos")]
use crate::supported_files::is_openable_supported;
// Unconditional, and it must stay that way: `record_ready_document_window` and
// `route_file_opens` both reach for `get_webview_window` / `webview_windows` on
// every platform. (An earlier revision had only macOS callers left here, and
// gating it was correct THEN — re-deriving that from the caller list is the
// check, not this comment.)
use tauri::Manager;

/// A file open request queued during cold start before the frontend is ready.
///
/// Solves the race condition where Finder opens a file but React hasn't mounted yet.
#[derive(Clone, serde::Serialize)]
pub struct PendingFileOpen {
    pub path: String,
    pub workspace_root: Option<String>,
}

/// Combined Finder file-open state — the readiness flag and the pending queue
/// live behind ONE mutex so the readiness check and the queue insertion happen
/// in a single critical section (WI-0.8, C3). See `window_manager::FileOpenState`.
pub(crate) static FILE_OPEN_STATE: Mutex<window_manager::FileOpenState> =
    Mutex::new(window_manager::FileOpenState::new());

/// Get and clear pending file opens - called by frontend when ready.
/// Marks the frontend ready and drains the queue atomically (one lock) so a
/// Finder open landing mid-call is never dropped or double-delivered.
#[tauri::command]
pub fn get_pending_file_opens() -> Vec<PendingFileOpen> {
    let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
    window_manager::mark_ready_and_drain(&mut state)
}

/// Update Finder's preferred hot-open destination from a native focus event.
pub(crate) fn record_document_window_focus(label: &str, focused: bool, listener_ready: bool) {
    let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
    state.record_window_focus(label, focused, listener_ready);
}

/// Seed focus history when a frontend reports that its listeners are ready.
pub(crate) fn record_ready_document_window(app: &tauri::AppHandle, label: &str) {
    let focused = app
        .get_webview_window(label)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    record_document_window_focus(label, focused, true);
}

/// Remove a destroyed window from Finder's focus history.
pub(crate) fn remove_document_window(label: &str) {
    let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
    state.remove_window(label);
}

/// macOS dock-icon reactivation with no visible windows: recreate a window,
/// restoring the user's last workspace so they don't land in an orphan doc.
#[cfg(target_os = "macos")]
pub(crate) fn handle_reopen(app: &tauri::AppHandle, has_visible_windows: bool) {
    if has_visible_windows {
        return;
    }
    // Prefer creating a "main" window so useFinderFileOpen works. Fall back to
    // doc-N if "main" already exists.
    let ws = window_manager::pick_reopen_workspace_root();
    if app.get_webview_window("main").is_none() {
        // Reset readiness so any subsequent Opened events are queued until the
        // new main window's React mounts and drains them.
        FILE_OPEN_STATE
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .frontend_ready = false;
        if let Err(e) = window_manager::create_main_window(app, ws.as_deref()) {
            log::error!("[Reopen] Failed to create main window: {}", e);
        }
    } else if let Err(e) = window_manager::create_document_window(app, None, ws.as_deref()) {
        log::error!("[Reopen] Failed to create document window: {}", e);
    }
}

/// Result of partitioning Finder `RunEvent::Opened` URLs into actionable
/// paths. Pure data — the caller performs the side effects per bucket.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct OpenedPaths {
    /// Directories: opened immediately as workspace windows.
    pub dirs: Vec<String>,
    /// Supported files: fs-scope extension + the queue/emit routing.
    pub files: Vec<String>,
    /// Rejected inputs (non-file URL, non-UTF-8 path, or unsupported
    /// extension) — logged, never opened. Unsupported files would create
    /// broken empty tabs (#661 audit gap 9.1). Media flows through this same
    /// gate so CLI and Finder filters stay in sync.
    pub skipped: Vec<String>,
}

/// Partition opened URLs into directories / supported files / skipped, with
/// the filesystem predicates injected so the decision logic is unit-testable.
/// Order within each bucket follows the input order.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // production caller is the macOS Opened handler
pub(crate) fn partition_opened_urls(
    urls: Vec<tauri::Url>,
    is_dir: impl Fn(&std::path::Path) -> bool,
    is_supported_file: impl Fn(&std::path::Path) -> bool,
) -> OpenedPaths {
    let mut out = OpenedPaths::default();
    for url in urls {
        let Ok(path) = url.to_file_path() else {
            out.skipped.push(url.to_string());
            continue;
        };
        let Some(path_str) = path.to_str() else {
            out.skipped.push(path.to_string_lossy().into_owned());
            continue;
        };
        if is_dir(&path) {
            out.dirs.push(path_str.to_string());
        } else if is_supported_file(&path) {
            out.files.push(path_str.to_string());
        } else {
            out.skipped.push(path_str.to_string());
        }
    }
    out
}

/// Convert Finder `RunEvent::Opened` URLs into queued/emitted file opens.
/// Directories open immediately; supported files are grouped by workspace root
/// and routed through the atomic `FILE_OPEN_STATE` decision.
#[cfg(target_os = "macos")]
pub(crate) fn handle_finder_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let opened = partition_opened_urls(urls, |p| p.is_dir(), is_openable_supported);

    for skipped in &opened.skipped {
        log::warn!("[Finder] Skipping unsupported open request: {}", skipped);
    }
    for dir in &opened.dirs {
        log::info!("[Finder] Opening directory: {}", dir);
        if let Err(e) = window_manager::create_document_window(app, None, Some(dir)) {
            log::error!(
                "[Finder] Failed to create window for directory {}: {}",
                dir,
                e
            );
        }
    }

    route_file_opens(app, opened.files);
}

/// Route already-filtered file paths to a ready document window, queueing them
/// for the next one when no window can take them yet.
///
/// Shared by the macOS `RunEvent::Opened` handler above and the Windows/Linux
/// single-instance callback (`crate::single_instance`), which arrive at the
/// same point by different roads — Finder hands macOS a URL list, Explorer
/// hands a second `vmark` process an argv. Both then need the identical
/// grouping, atomic decide, and emit-or-queue behaviour, so it lives once.
pub(crate) fn route_file_opens(app: &tauri::AppHandle, file_paths: Vec<String>) {
    if file_paths.is_empty() {
        return;
    }
    // Extend fs read scope so the webview's readTextFile succeeds for paths
    // outside the static capability scope. See allow_fs_read docs.
    for path in &file_paths {
        crate::allow_fs_read(app, path);
    }
    log::info!("[FileOpen] Opening {} file(s)", file_paths.len());

    let groups = window_manager::group_paths_by_workspace(&file_paths);
    for (workspace_key, paths) in groups {
        let ws = if workspace_key.is_empty() {
            None
        } else {
            Some(workspace_key.as_str())
        };

        // Decide + queue atomically under one lock (WI-0.8, C3): the readiness
        // check and any queue insertion happen in a single critical section, so
        // a concurrent get_pending_file_opens can't interleave to drop or
        // double-deliver.
        let live_labels: Vec<String> = app.webview_windows().keys().cloned().collect();
        let outcome = {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            let has_ready_target = state.finder_window_target(&live_labels).is_some();
            window_manager::decide_file_open_locked(&mut state, has_ready_target, paths, ws)
        };

        match outcome {
            window_manager::FileOpenOutcome::Emit(payloads) => {
                window_manager::emit_finder_opens_to_window(app, payloads);
            }
            window_manager::FileOpenOutcome::Queued { create_window } => {
                if create_window {
                    if app.get_webview_window("main").is_none() {
                        log::info!("[FileOpen] Queueing files, creating main window");
                        if let Err(e) = window_manager::create_main_window(app, None) {
                            log::error!(
                                "[FileOpen] Failed to create main window for queued opens: {}",
                                e
                            );
                        }
                    } else {
                        log::info!("[FileOpen] Queueing files until main window is ready");
                    }
                } else {
                    log::info!("[FileOpen] Queueing files (frontend not ready)");
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "file_open.test.rs"]
mod tests;
