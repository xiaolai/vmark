//! Tauri commands for hot exit
//!
//! These commands provide session capture, restore, and management for the hot exit feature.
//! They are used both in production (update restart flow) and for developer testing.

use super::coordinator::{
    capture_session, restore_session, restore_session_multi_window, CaptureResult,
    RestoreMultiWindowResult,
};
use super::merge::merge_partial_capture;
use super::read_session::read_session;
use super::session::{LoadedSession, SessionData, WindowState};
use super::state::HotExitState;
use super::storage::{delete_session, write_session_atomic};
use crate::command_error::CommandError;
use tauri::{AppHandle, State};

/// Capture session from all windows and persist to disk atomically.
///
/// If the capture is partial (some windows timed out), merges with the
/// previous session so that missing windows retain their last-known state
/// instead of being silently dropped.
#[tauri::command]
pub async fn hot_exit_capture(
    app: AppHandle,
    hot_exit: State<'_, HotExitState>,
) -> Result<SessionData, CommandError> {
    // Capture outside the lock — the IPC broadcast can take up to CAPTURE_TIMEOUT_SECS.
    // Only the read-merge-write section needs serialization.
    let CaptureResult {
        session,
        expected_labels,
    } = capture_session(&app).await.map_err(CommandError::io)?;
    let _guard = hot_exit.capture_lock().await;

    // Merge partial captures (pure logic, table-tested in merge.rs): only
    // resurrect windows that were expected (alive at capture time) but
    // failed to respond. Windows that were intentionally closed are NOT in
    // expected_labels and won't be merged.
    let prev_session = read_session(&app)
        .await
        .ok()
        .flatten()
        .map(|loaded| loaded.session);
    let session = merge_partial_capture(
        session,
        prev_session,
        &expected_labels,
        chrono::Utc::now().timestamp(),
    );

    write_session_atomic(&app, &session)
        .await
        .map_err(CommandError::io)?;
    Ok(session)
}

/// Restore session to current window from provided session data
#[tauri::command]
pub fn hot_exit_restore(app: AppHandle, session: SessionData) -> Result<(), CommandError> {
    restore_session(&app, session).map_err(CommandError::io)
}

/// The inspect payload: every `SessionData` field, flattened, plus the
/// provenance flag (audit 20260803 §11).
///
/// Flattened rather than nested so the frontend's existing salvage pass reads
/// the same object it always did; the schema passes unknown fields through, and
/// `restartWithHotExit.ts::wasRecoveredFromBackup` was written to tolerate the
/// flag's absence so the two halves could land in either order.
///
/// Omitted when false, matching the crate's "absent optionals are ABSENT"
/// convention — the frontend reader tests for `=== true`, not for presence.
#[derive(serde::Serialize)]
pub struct InspectedSession {
    #[serde(flatten)]
    session: SessionData,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    recovered_from_backup: bool,
    /// The main file parsed only after per-item salvage DROPPED content
    /// (audit 20260906, B5/B6). Same contract as `recovered_from_backup`: the
    /// original bytes are still on disk and must be quarantined before the
    /// restore path clears them. A lossy repair of the main file used to be
    /// reported as ordinary main data, so the evidence was deleted on success.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    lossy_repair: bool,
    /// What the repair dropped, for the quarantine record.
    #[serde(skip_serializing_if = "Option::is_none")]
    repair_summary: Option<String>,
}

impl From<LoadedSession> for InspectedSession {
    fn from(loaded: LoadedSession) -> Self {
        Self {
            session: loaded.session,
            recovered_from_backup: loaded.recovered_from_backup,
            lossy_repair: loaded.lossy_repair,
            repair_summary: loaded.repair_summary,
        }
    }
}

/// Inspect the saved session file (returns None if no session exists).
///
/// When this reports `recovered_from_backup`, the corrupt `session.json` is
/// still on disk: the frontend must quarantine it before the restore path
/// clears the session files.
#[tauri::command]
pub async fn hot_exit_inspect_session(
    app: AppHandle,
) -> Result<Option<InspectedSession>, CommandError> {
    Ok(read_session(&app)
        .await
        .map_err(CommandError::io)?
        .map(InspectedSession::from))
}

/// Delete the saved session file
#[tauri::command]
pub async fn hot_exit_clear_session(
    app: AppHandle,
    hot_exit: State<'_, HotExitState>,
) -> Result<(), CommandError> {
    // Also clear pending restore state
    hot_exit.clear();
    delete_session(&app).await.map_err(CommandError::io)
}

/// Initialize multi-window restore
///
/// Creates secondary windows and stores session state for pull-based restoration.
/// Returns list of created window labels.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn hot_exit_restore_multi_window(
    app: AppHandle,
    session: SessionData,
) -> Result<RestoreMultiWindowResult, CommandError> {
    restore_session_multi_window(&app, session).map_err(CommandError::io)
}

/// Get pending window state for restoration
///
/// Called by windows on startup to get their pending restore state.
/// Returns None if no state is pending for the given window.
#[tauri::command]
pub fn hot_exit_get_window_state(
    hot_exit: State<'_, HotExitState>,
    window_label: String,
) -> Option<WindowState> {
    hot_exit.window_state(&window_label)
}

/// Mark a window as having completed restoration
///
/// Returns true if all expected windows have completed.
#[tauri::command]
pub fn hot_exit_window_restore_complete(
    hot_exit: State<'_, HotExitState>,
    window_label: String,
) -> bool {
    hot_exit.mark_complete(&window_label)
}
