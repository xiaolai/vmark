//! Tauri commands for hot exit
//!
//! These commands provide session capture, restore, and management for the hot exit feature.
//! They are used both in production (update restart flow) and for developer testing.

use std::sync::LazyLock;
use tokio::sync::Mutex;
use tauri::AppHandle;
use super::session::{SessionData, WindowState};
use super::storage::{read_session, delete_session, write_session_atomic};
use super::coordinator::{
    capture_session,
    restore_session,
    restore_session_multi_window,
    get_window_restore_state,
    mark_window_restore_complete,
    clear_pending_restore,
    CaptureResult,
    RestoreMultiWindowResult,
};

/// Serialization guard for the read-merge-write section of `hot_exit_capture`.
/// Prevents TOCTOU races when two concurrent captures (e.g., restart + settings button)
/// both read the previous session, merge independently, and clobber each other's result.
static CAPTURE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Capture session from all windows and persist to disk atomically.
///
/// If the capture is partial (some windows timed out), merges with the
/// previous session so that missing windows retain their last-known state
/// instead of being silently dropped.
#[tauri::command]
pub async fn hot_exit_capture(app: AppHandle) -> Result<SessionData, String> {
    // Capture outside the lock — the IPC broadcast can take up to CAPTURE_TIMEOUT_SECS.
    // Only the read-merge-write section needs serialization.
    let CaptureResult { mut session, expected_labels } = capture_session(&app).await?;
    let _guard = CAPTURE_LOCK.lock().await;

    // Merge partial captures: only resurrect windows that were expected (alive
    // at capture time) but failed to respond (timed out). Windows that were
    // intentionally closed are NOT in expected_labels and won't be merged.
    let captured_labels: std::collections::HashSet<String> = session
        .windows
        .iter()
        .map(|w| w.window_label.clone())
        .collect();

    if let Ok(Some(prev_session)) = read_session(&app).await {
        let mut merged = false;
        let now = chrono::Utc::now().timestamp();
        let prev_age_secs = now.checked_sub(prev_session.timestamp);

        // Refuse to merge if previous session is older than 1 hour,
        // has a future timestamp, or the age overflows
        let max_merge_age_secs: i64 = 3600;
        let is_stale = match prev_age_secs {
            Some(age) if age >= 0 && age <= max_merge_age_secs => false,
            _ => true, // overflow, negative (future), or too old
        };
        if is_stale {
            log::debug!(
                "[HotExit] Skipping stale merge: previous session age {:?}s (max {}s)",
                prev_age_secs, max_merge_age_secs
            );
        } else {
            for prev_window in prev_session.windows {
                if expected_labels.contains(&prev_window.window_label)
                    && !captured_labels.contains(&prev_window.window_label)
                {
                    log::debug!(
                        "[HotExit] Merging previous state for timed-out window '{}' ({:?}s old)",
                        prev_window.window_label, prev_age_secs
                    );
                    session.windows.push(prev_window);
                    merged = true;
                }
            }
        }
        if merged {
            // Re-sort: main window first, then by label
            session.windows.sort_by(|a, b| {
                match (a.is_main_window, b.is_main_window) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.window_label.cmp(&b.window_label),
                }
            });
        }

        // Preserve workspace from previous session if not set
        // (workspace capture not yet implemented, so current capture always has None)
        if session.workspace.is_none() {
            session.workspace = prev_session.workspace;
        }
    }

    write_session_atomic(&app, &session).await?;
    Ok(session)
}

/// Restore session to current window from provided session data
#[tauri::command]
pub fn hot_exit_restore(app: AppHandle, session: SessionData) -> Result<(), String> {
    restore_session(&app, session)
}

/// Inspect the saved session file (returns None if no session exists)
#[tauri::command]
pub async fn hot_exit_inspect_session(app: AppHandle) -> Result<Option<SessionData>, String> {
    read_session(&app).await
}

/// Delete the saved session file
#[tauri::command]
pub async fn hot_exit_clear_session(app: AppHandle) -> Result<(), String> {
    // Also clear pending restore state
    clear_pending_restore();
    delete_session(&app).await
}

/// Initialize multi-window restore
///
/// Creates secondary windows and stores session state for pull-based restoration.
/// Returns list of created window labels.
#[tauri::command]
pub fn hot_exit_restore_multi_window(
    app: AppHandle,
    session: SessionData,
) -> Result<RestoreMultiWindowResult, String> {
    restore_session_multi_window(&app, session)
}

/// Get pending window state for restoration
///
/// Called by windows on startup to get their pending restore state.
/// Returns None if no state is pending for the given window.
#[tauri::command]
pub fn hot_exit_get_window_state(window_label: String) -> Option<WindowState> {
    get_window_restore_state(&window_label)
}

/// Mark a window as having completed restoration
///
/// Returns true if all expected windows have completed.
#[tauri::command]
pub fn hot_exit_window_restore_complete(window_label: String) -> bool {
    mark_window_restore_complete(&window_label)
}
