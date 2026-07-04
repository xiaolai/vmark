//! Finder/CLI file-open queueing, fs-scope extension, and macOS reopen.
//!
//! Purpose: Owns the cold-start file-open queue and the macOS
//! `RunEvent::Opened` / `RunEvent::Reopen` handlers. Extracted verbatim from
//! `lib.rs` to keep that file under the size gate.
//!
//! Key decisions:
//!   - File opens from Finder are queued in `FILE_OPEN_STATE` until the frontend
//!     signals readiness, solving a cold-start race condition. Only files with a
//!     registered extension are accepted; others are skipped. Hot opens (app
//!     already running) use `app.emit()` (global broadcast) — NOT `window.emit()`
//!     — so the frontend's global `listen()` in `useFinderFileOpen` receives
//!     them. Tauri v2 webview-specific events are not delivered to global
//!     `listen()`.
//!   - macOS Reopen event (dock click) creates a new main window when none
//!     visible, restoring the user's most-recent workspace via
//!     `window_manager::pick_reopen_workspace_root` so closing the last tab and
//!     re-clicking the dock doesn't drop them into an orphan untitled doc.

use std::sync::Mutex;

use crate::window_manager;

#[cfg(target_os = "macos")]
use crate::supported_files::is_openable_supported;
// Unconditional: `allow_fs_read` (all platforms) needs Manager for
// `asset_protocol_scope()` — a cfg(macos) gate here breaks Linux/Windows.
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

/// Runtime-extend the fs + asset read scopes for a path the user asked to open.
/// The static capability scope (`capabilities/default.json`) covers `$HOME/**`,
/// `/Volumes/**`, `/mnt/**`, `/media/**`; files from Finder / CLI / "open in new
/// window" can live anywhere (`/private/tmp`, `/etc`), so `readTextFile` rejects
/// them until extended here. The asset-protocol scope (cwd-relative) needs the
/// same per-file grant so `convertFileSrc`/asset:// serves the file (inline
/// images + media viewer). Best-effort: failures logged, not propagated.
pub(crate) fn allow_fs_read<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    use tauri_plugin_fs::FsExt;
    if let Err(e) = app.fs_scope().allow_file(path) {
        log::warn!("[fs-scope] Failed to allow file '{}': {}", path, e);
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!("[asset-scope] Failed to allow file '{}': {}", path, e);
    }
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

    let file_paths = opened.files;
    if file_paths.is_empty() {
        return;
    }
    // Extend fs read scope so the webview's readTextFile succeeds for paths
    // outside the static capability scope. See allow_fs_read docs.
    for path in &file_paths {
        allow_fs_read(app, path);
    }
    log::info!("[Finder] Opening {} file(s)", file_paths.len());

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
        let outcome = {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            window_manager::decide_file_open_locked(
                &mut state,
                app.get_webview_window("main").is_some(),
                paths,
                ws,
            )
        };

        match outcome {
            window_manager::FileOpenOutcome::Emit(payloads) => {
                emit_finder_opens_to_main(app, payloads);
            }
            window_manager::FileOpenOutcome::Queued { create_window } => {
                if create_window {
                    log::info!("[Finder] Queueing files, creating main window");
                    if let Err(e) = window_manager::create_main_window(app, None) {
                        log::error!(
                            "[Finder] Failed to create main window for queued opens: {}",
                            e
                        );
                    }
                } else {
                    log::info!("[Finder] Queueing files (frontend not ready)");
                }
            }
        }
    }
}

/// Emit decided Finder opens to the main window, re-queueing if the window
/// vanished between the decision and the emit (the decision is made under the
/// lock based on the main window existing THEN; `app.emit` is a global
/// broadcast that returns Ok even with no listener).
#[cfg(target_os = "macos")]
fn emit_finder_opens_to_main(app: &tauri::AppHandle, payloads: Vec<PendingFileOpen>) {
    use tauri::Emitter;
    if app.get_webview_window("main").is_none() {
        log::info!("[Finder] main window vanished before emit — re-queueing");
        {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            state.frontend_ready = false;
            state.pending.extend(payloads);
        }
        if let Err(e) = window_manager::create_main_window(app, None) {
            log::error!(
                "[Finder] Failed to recreate main window for re-queued opens: {}",
                e
            );
        }
        return;
    }

    log::info!("[Finder] Emitting to main window");
    // app.emit() (global broadcast) so the frontend's global listen() in
    // useFinderFileOpen receives it. window.emit() is webview-specific and is
    // NOT delivered to @tauri-apps/api/event listen().
    let mut failed: Vec<PendingFileOpen> = Vec::new();
    for payload in payloads {
        if let Err(e) = app.emit("app:open-file", payload.clone()) {
            log::warn!("[Finder] emit failed, queueing: {e}");
            failed.push(payload);
        }
    }
    if !failed.is_empty() {
        // Emit failed mid-flight — re-queue and reset readiness so the open
        // isn't lost; create a main window if none remains to drain it.
        {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            state.frontend_ready = false;
            state.pending.extend(failed);
        }
        if app.get_webview_window("main").is_none() {
            if let Err(e) = window_manager::create_main_window(app, None) {
                log::error!(
                    "[Finder] Failed to create main window after emit failure: {}",
                    e
                );
            }
        }
    }
}

#[cfg(test)]
#[path = "file_open.test.rs"]
mod tests;
