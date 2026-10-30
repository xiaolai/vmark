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
//!   - A folder opened from Finder, or passed as a launch argument on Windows
//!     and Linux, is a folder the user chose: it is granted and recorded
//!     through `workspace::grants` before its window opens.
//!   - `RunEvent::Opened` arrives on the event loop, and handling it touches
//!     the disk — classifying each URL, resolving and recording a folder, a
//!     grant file fsync. On a stale network mount any of those blocks for the
//!     mount's timeout, freezing every window, so the handler hands the whole
//!     batch to the blocking pool (`off_event_loop`) and returns. Two batches
//!     can then overlap; each routes its files atomically, as before.
//!   - File opens from Finder are queued in the app's `FileOpenStore` while a
//!     `main` window is booting, and drained by it when its frontend mounts,
//!     solving a cold-start race condition. When that window is destroyed the
//!     queue has no owner, and the next open brings a new one up instead of
//!     waiting for a window that is gone. Only files with a
//!     registered extension are accepted; others are skipped. Hot opens (app
//!     already running) target the last focused document window, attach that
//!     label to an `app.emit()` global broadcast, and bring the native window
//!     forward. Each frontend window filters the broadcast by target label.
//!   - macOS Reopen event (dock click) creates a new main window when none
//!     visible, restoring the user's most-recent workspace via
//!     `window_manager::pick_reopen_workspace_root` so closing the last tab and
//!     re-clicking the dock doesn't drop them into an orphan untitled doc.

use crate::window_manager::{self, file_open_state};

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

/// Get and clear pending file opens - called by frontend when ready.
/// Settles the queue's owner and drains the queue atomically (one lock) so a
/// Finder open landing mid-call is never dropped or double-delivered. The
/// calling window is recorded as listening for hot opens from here on.
#[tauri::command]
pub fn get_pending_file_opens<R: tauri::Runtime>(window: tauri::Window<R>) -> Vec<PendingFileOpen> {
    let store = file_open_state(window.app_handle());
    let mut state = store.lock();
    window_manager::mark_ready_and_drain(&mut state, window.label())
}

/// Update Finder's preferred hot-open destination from a native focus event.
pub(crate) fn record_document_window_focus<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    focused: bool,
    listener_ready: bool,
) {
    file_open_state(app)
        .lock()
        .record_window_focus(label, focused, listener_ready);
}

/// Seed focus history when a frontend reports that its listeners are ready.
pub(crate) fn record_ready_document_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) {
    let focused = app
        .get_webview_window(label)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    record_document_window_focus(app, label, focused, true);
}

/// Forget a destroyed window: it is no longer a hot-open target, and if it
/// was `main`, the cold-start queue no longer has a window booting for it.
pub(crate) fn remove_document_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    file_open_state(app).lock().remove_window(label);
}

/// macOS dock-icon reactivation with no visible windows: recreate a window,
/// restoring the user's last workspace so they don't land in an orphan doc.
#[cfg(target_os = "macos")]
pub(crate) fn handle_reopen(app: &tauri::AppHandle, has_visible_windows: bool) {
    if has_visible_windows {
        return;
    }
    // Prefer creating a "main" window so useFinderFileOpen works. Fall back to
    // doc-N if "main" already exists. Building main resets file-open readiness
    // (`ensure_main_window`), so Opened events from here on are queued until
    // the new window's React mounts and drains them.
    let ws = window_manager::pick_reopen_workspace_root();
    match window_manager::ensure_main_window(app, ws.as_deref()) {
        Ok(window_manager::Ensured::Created(_)) => {}
        Ok(_) => {
            if let Err(e) = window_manager::create_document_window(app, None, ws.as_deref()) {
                log::error!("[Reopen] Failed to create document window: {}", e);
            }
        }
        Err(e) => log::error!("[Reopen] Failed to create main window: {}", e),
    }
}

/// Result of partitioning Finder `RunEvent::Opened` URLs into actionable
/// paths. Pure data — the caller performs the side effects per bucket.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Default, PartialEq)]
pub(crate) struct OpenedPaths {
    /// Directories: opened immediately as workspace windows.
    pub dirs: Vec<String>,
    /// Supported files: fs-scope extension + the queue/emit routing.
    pub files: Vec<String>,
    /// Rejected inputs (non-file URL, non-UTF-8 path, or unsupported
    /// extension) — logged, never opened. Unsupported files would create
    /// broken empty tabs. Media flows through this same
    /// gate so CLI and Finder filters stay in sync.
    pub skipped: Vec<String>,
}

/// Partition opened URLs into directories / supported files / skipped, with
/// the filesystem predicates injected so the decision logic is unit-testable.
/// Order within each bucket follows the input order. Compiled where it runs:
/// the macOS Opened handler, and the tests.
#[cfg(any(target_os = "macos", test))]
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

/// Convert Finder `RunEvent::Opened` URLs into queued/emitted file opens, off
/// the event loop (see module docs). Directories open immediately; supported
/// files are grouped by workspace root and routed through the atomic
/// `FileOpenState` decision.
#[cfg(target_os = "macos")]
pub(crate) fn handle_finder_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let app = app.clone();
    off_event_loop(move || open_finder_urls(&app, urls));
}

/// Run `job` on the blocking pool and return at once: the caller is the event
/// loop, which every window's input and every IPC reply waits on.
#[cfg(any(target_os = "macos", all(test, not(target_os = "windows"))))]
pub(crate) fn off_event_loop(job: impl FnOnce() + Send + 'static) {
    drop(tauri::async_runtime::spawn_blocking(job));
}

#[cfg(target_os = "macos")]
fn open_finder_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let opened = partition_opened_urls(urls, |p| p.is_dir(), is_openable_supported);

    log_skipped_opens(&opened.skipped);
    for dir in &opened.dirs {
        open_finder_directory(app, dir);
    }

    route_file_opens(app, opened.files);
}

/// Say which open requests were refused. Each is a URL or path the OS handed
/// over, so it is logged as escaped, bounded text.
#[cfg(any(target_os = "macos", test))]
fn log_skipped_opens(skipped: &[String]) {
    for request in skipped {
        let request = crate::peer_text::peer_message(request);
        log::warn!("[Finder] Skipping unsupported open request: {request}");
    }
}

/// Open a folder handed over by the OS as a workspace window (WI-LX1.1):
/// from Finder on macOS, as a launch argument on Windows and Linux (the first
/// launch in `app_setup`, a later one through `single_instance`).
///
/// Opening a folder in VMark this way IS the user choosing it, so it is
/// granted recursively and recorded like a folder-picker choice before the
/// window can read it — without that, a folder outside the static scope opened
/// a window that could read nothing in it. The window gets the canonical root
/// the grant judged; a folder that vanished since the partition opens
/// nothing.
pub(crate) fn open_finder_directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dir: &str) {
    use crate::peer_text::peer_message;

    let root = match crate::workspace::grants::grant_chosen_root(app, std::path::Path::new(dir)) {
        Ok(root) => root,
        Err(e) => {
            // The error text quotes the path it refused, so both go escaped.
            let (dir, why) = (peer_message(dir), peer_message(e.message()));
            log::error!("[FileOpen] Not opening directory {dir}: {why}");
            return;
        }
    };
    let shown = peer_message(&root);
    log::info!("[FileOpen] Opening directory: {shown}");
    if let Err(e) = window_manager::create_document_window(app, None, Some(&root)) {
        log::error!("[FileOpen] Failed to create window for directory {shown}: {e}");
    }
}

/// Route already-filtered file paths to a ready document window, queueing them
/// for the next one when no window can take them yet.
///
/// Shared by the macOS `RunEvent::Opened` handler above and the Windows/Linux
/// single-instance callback (`crate::single_instance`), which arrive at the
/// same point by different roads — Finder hands macOS a URL list, Explorer
/// hands a second `vmark` process an argv. Both then need the identical
/// grouping, atomic decide, and emit-or-queue behaviour, so it lives once.
pub(crate) fn route_file_opens<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    file_paths: Vec<String>,
) {
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

        // Decide + queue atomically under one lock: the readiness
        // check and any queue insertion happen in a single critical section, so
        // a concurrent get_pending_file_opens can't interleave to drop or
        // double-deliver.
        let live_labels: Vec<String> = app.webview_windows().keys().cloned().collect();
        let outcome = {
            let store = file_open_state(app);
            let mut state = store.lock();
            let has_ready_target = state.finder_window_target(&live_labels).is_some();
            window_manager::decide_file_open_locked(&mut state, has_ready_target, paths, ws)
        };

        match outcome {
            window_manager::FileOpenOutcome::Emit(payloads) => {
                window_manager::emit_finder_opens_to_window(app, payloads);
            }
            window_manager::FileOpenOutcome::Queued { create_window } => {
                if create_window {
                    window_manager::bring_up_queue_owner(app);
                } else {
                    log::info!("[FileOpen] Queueing files (main window is booting)");
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "open.test.rs"]
mod tests;
