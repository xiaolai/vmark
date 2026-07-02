//! Coordinator for hot exit capture and restore
//!
//! Orchestrates multi-window capture with timeout and restore logic.
//! Supports multi-window restoration with pull-based state retrieval.

use super::migration::{can_migrate, migrate_session, needs_migration};
use super::session::{SessionData, WindowState, MAX_SESSION_AGE_DAYS, SCHEMA_VERSION};
use super::{
    EVENT_CAPTURE_REQUEST, EVENT_CAPTURE_RESPONSE, EVENT_CAPTURE_TIMEOUT, EVENT_RESTORE_START,
    MAIN_WINDOW_LABEL,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::time::{timeout, Duration};

/// Polling interval for waiting on responses
const RESPONSE_POLL_INTERVAL_MS: u64 = 100;

/// Capture timeout in seconds
const CAPTURE_TIMEOUT_SECS: u64 = 5;

/// Timeout for pending restore state cleanup (seconds).
/// If not all windows complete within this window, state is cleared to avoid leaks.
const RESTORE_TIMEOUT_SECS: u64 = 60;

/// Pending restore state for multi-window restoration
/// Windows pull their state from here on startup
#[derive(Debug, Default)]
pub(crate) struct PendingRestoreState {
    /// Window states indexed by window label
    pub window_states: HashMap<String, WindowState>,
    /// Set of window labels that are expected to complete restoration
    pub expected_labels: HashSet<String>,
    /// Labels of windows that have completed restoration
    pub completed_windows: HashSet<String>,
    /// Generation counter — incremented on each new restore to invalidate stale timeouts
    pub generation: u64,
}

impl PendingRestoreState {
    /// Check if all expected windows have completed
    fn all_complete(&self) -> bool {
        !self.expected_labels.is_empty()
            && self
                .expected_labels
                .iter()
                .all(|label| self.completed_windows.contains(label))
    }

    /// Clear all state (preserves generation counter)
    fn clear(&mut self) {
        self.window_states.clear();
        self.expected_labels.clear();
        self.completed_windows.clear();
    }

    /// Advance generation and clear all state
    fn advance_and_clear(&mut self) {
        self.generation += 1;
        self.clear();
    }
}

/// Global pending restore state
static PENDING_RESTORE: OnceLock<Arc<Mutex<PendingRestoreState>>> = OnceLock::new();

/// Handle for the active restore timeout task (cancelled on new restore).
/// In production we use `tauri::async_runtime::spawn` (works from any thread);
/// in tests we use `tokio::spawn` (works with `start_paused` time control).
#[cfg(not(test))]
type TimeoutJoinHandle = tauri::async_runtime::JoinHandle<()>;
#[cfg(test)]
type TimeoutJoinHandle = tokio::task::JoinHandle<()>;

static RESTORE_TIMEOUT_HANDLE: OnceLock<Arc<Mutex<Option<TimeoutJoinHandle>>>> = OnceLock::new();

fn get_timeout_handle() -> Arc<Mutex<Option<TimeoutJoinHandle>>> {
    Arc::clone(RESTORE_TIMEOUT_HANDLE.get_or_init(|| Arc::new(Mutex::new(None))))
}

/// Get the pending restore state (for internal use)
pub(crate) fn get_pending_restore_state() -> Arc<Mutex<PendingRestoreState>> {
    Arc::clone(PENDING_RESTORE.get_or_init(|| Arc::new(Mutex::new(PendingRestoreState::default()))))
}

/// Lock the pending restore state, recovering from poisoning
fn lock_pending_restore(
    pending: &Arc<Mutex<PendingRestoreState>>,
) -> std::sync::MutexGuard<'_, PendingRestoreState> {
    pending.lock().unwrap_or_else(|poisoned| {
        log::warn!("[HotExit] Recovering from poisoned mutex");
        poisoned.into_inner()
    })
}

/// Clear pending restore state
pub fn clear_pending_restore() {
    let pending = get_pending_restore_state();
    let mut state = lock_pending_restore(&pending);
    state.clear();
}

/// Capture request payload with correlation ID
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CaptureRequest {
    pub capture_id: String,
}

/// Capture response from a window
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CaptureResponse {
    pub capture_id: String,
    pub window_label: String,
    pub state: WindowState,
}

/// Process-wide monotonic counter that disambiguates capture IDs generated
/// within the same millisecond. `capture_session` runs the IPC broadcast
/// BEFORE `hot_exit_capture` takes the capture lock, so two captures kicked
/// off in the same millisecond would otherwise share a timestamp-only ID and
/// each accept the other's responses. Pairing the timestamp with this counter
/// makes every capture ID unique within the process lifetime.
static CAPTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Generate a process-unique capture correlation ID.
///
/// Combines the wall-clock millisecond (useful for log correlation) with a
/// monotonic per-process sequence number so two captures started in the same
/// millisecond never collide.
fn generate_capture_id() -> String {
    let seq = CAPTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("capture-{}-{}", chrono::Utc::now().timestamp_millis(), seq)
}

/// Coordinator state for collecting window responses
struct CaptureState {
    capture_id: String,
    expected_windows: HashSet<String>,
    responses: HashMap<String, WindowState>,
}

/// Normalize window state label to match expected label
fn normalize_window_label(state: &mut WindowState, expected_label: &str) {
    if state.window_label != expected_label {
        log::debug!(
            "[HotExit] Normalizing mismatched window_label: {} -> {}",
            state.window_label,
            expected_label
        );
        state.window_label = expected_label.to_string();
    }
}

/// Result of `capture_session`, including the captured session data and the
/// set of expected window labels (to distinguish closed vs. timed-out windows).
pub struct CaptureResult {
    pub session: SessionData,
    pub expected_labels: HashSet<String>,
}

/// Enumerate the document windows (main + doc-*) eligible for capture.
fn discover_document_windows(app: &AppHandle) -> Vec<String> {
    app.webview_windows()
        .into_keys()
        .filter_map(|label| {
            if label == MAIN_WINDOW_LABEL || label.starts_with("doc-") {
                Some(label)
            } else {
                None
            }
        })
        .collect()
}

/// Register the capture-response listener that accumulates window states into
/// `state`. Returns the listener handle so the caller can unlisten when done.
fn register_response_listener(app: &AppHandle, state: Arc<Mutex<CaptureState>>) -> tauri::EventId {
    app.listen(EVENT_CAPTURE_RESPONSE, move |event| {
        match serde_json::from_str::<CaptureResponse>(event.payload()) {
            Ok(mut response) => {
                let mut state = state.lock().unwrap_or_else(|poisoned| {
                    log::warn!("[HotExit] Recovering from poisoned capture state mutex");
                    poisoned.into_inner()
                });

                // Ignore responses from different capture requests (stale responses)
                if response.capture_id != state.capture_id {
                    log::warn!(
                        "[HotExit] Ignoring stale response (capture_id mismatch: {} vs {})",
                        response.capture_id,
                        state.capture_id
                    );
                    return;
                }

                // Only accept responses from expected windows
                if !state.expected_windows.contains(&response.window_label) {
                    log::warn!(
                        "[HotExit] Ignoring response from unexpected window: {}",
                        response.window_label
                    );
                    return;
                }

                // Ignore duplicate responses from the same window
                if state.responses.contains_key(&response.window_label) {
                    log::warn!(
                        "[HotExit] Ignoring duplicate response from window: {}",
                        response.window_label
                    );
                    return;
                }

                // Normalize: ensure state.window_label matches the response key
                normalize_window_label(&mut response.state, &response.window_label);

                state
                    .responses
                    .insert(response.window_label.clone(), response.state);
            }
            Err(e) => {
                log::error!(
                    "[HotExit] Failed to parse capture response ({}): {}",
                    event.payload().len(),
                    e
                );
            }
        }
    })
}

/// Report a timeout outcome: emit the timeout event, and (if at least one
/// window responded) surface a partial-capture warning to the frontend.
///
/// Returns `Err` only for the critical zero-response case; `Ok(())` means the
/// caller should keep the partial responses it has.
fn report_capture_timeout(
    app: &AppHandle,
    got_responses: usize,
    expected_responses: usize,
    missing: &[&String],
) -> Result<(), String> {
    log::warn!(
        "[HotExit] Timeout: Got {}/{} window responses. Missing: {:?}",
        got_responses,
        expected_responses,
        missing
    );
    if let Err(e) = app.emit(EVENT_CAPTURE_TIMEOUT, ()) {
        log::error!("[HotExit] Failed to emit capture timeout event: {}", e);
    }

    // If we got zero responses, this is a critical failure
    if got_responses == 0 {
        return Err(rust_i18n::t!("errors.hotExit.captureTimeout").to_string());
    }

    // Partial capture — log warning and notify frontend
    log::warn!(
        "[HotExit] Saving partial session ({}/{} windows). State for {:?} was lost.",
        got_responses,
        expected_responses,
        missing
    );
    // Surface partial capture warning to frontend so it can inform the user
    let _ = app.emit(
        "hot-exit:partial-capture",
        serde_json::json!({
            "captured": got_responses,
            "expected": expected_responses,
            "missing": missing,
        }),
    );
    Ok(())
}

/// Sort captured window states deterministically (main first, then by label).
fn sort_windows_deterministically(windows: &mut [WindowState]) {
    windows.sort_by(|a, b| match (a.is_main_window, b.is_main_window) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.window_label.cmp(&b.window_label),
    });
}

/// Assemble a `SessionData` from the collected window states.
fn assemble_session(mut windows: Vec<WindowState>) -> SessionData {
    sort_windows_deterministically(&mut windows);
    SessionData {
        version: SCHEMA_VERSION,
        timestamp: chrono::Utc::now().timestamp(),
        vmark_version: env!("CARGO_PKG_VERSION").to_string(),
        windows,
        workspace: None, // Workspace capture not yet implemented
    }
}

/// Capture session from all windows
pub async fn capture_session(app: &AppHandle) -> Result<CaptureResult, String> {
    // Get all document windows (main + doc-*)
    let windows = discover_document_windows(app);

    if windows.is_empty() {
        return Err(rust_i18n::t!("errors.hotExit.noWindows").to_string());
    }

    // Generate unique capture ID for this request (timestamp + atomic seq —
    // collision-free even for captures started in the same millisecond).
    let capture_id = generate_capture_id();

    // Use std::sync::Mutex (not tokio::sync::Mutex) because the listener callback
    // runs on the tokio runtime and blocking_lock() would panic
    let state = Arc::new(Mutex::new(CaptureState {
        capture_id: capture_id.clone(),
        expected_windows: windows.iter().cloned().collect(),
        responses: HashMap::new(),
    }));

    // Listen for responses
    let unlisten = register_response_listener(app, state.clone());

    // Broadcast capture request with capture_id - ensure unlisten on failure
    let request = CaptureRequest { capture_id };
    if let Err(e) = app.emit(EVENT_CAPTURE_REQUEST, &request) {
        app.unlisten(unlisten);
        return Err(
            rust_i18n::t!("errors.hotExit.captureEmitFailed", detail = e.to_string()).to_string(),
        );
    }

    // Wait for responses with timeout
    let result = timeout(
        Duration::from_secs(CAPTURE_TIMEOUT_SECS),
        wait_for_all_responses(state.clone(), windows.len()),
    )
    .await;

    // Always unlisten after waiting
    app.unlisten(unlisten);

    let final_state = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if result.is_err() {
        let missing: Vec<&String> = final_state
            .expected_windows
            .iter()
            .filter(|w| !final_state.responses.contains_key(*w))
            .collect();
        report_capture_timeout(
            app,
            final_state.responses.len(),
            final_state.expected_windows.len(),
            &missing,
        )?;
    }

    let windows_vec: Vec<WindowState> = final_state.responses.values().cloned().collect();
    let expected_labels = final_state.expected_windows.clone();
    let session = assemble_session(windows_vec);

    Ok(CaptureResult {
        session,
        expected_labels,
    })
}

async fn wait_for_all_responses(state: Arc<Mutex<CaptureState>>, expected: usize) {
    loop {
        {
            let current = state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if current.responses.len() >= expected {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(RESPONSE_POLL_INTERVAL_MS)).await;
    }
}

/// Prepare session for restoration: migrate if needed, validate version and staleness
fn prepare_session_for_restore(session: SessionData) -> Result<SessionData, String> {
    // Migrate session if needed
    let session = if needs_migration(&session) {
        log::info!(
            "[HotExit] Migrating session from v{} to v{}",
            session.version,
            SCHEMA_VERSION
        );
        migrate_session(session)?
    } else if !can_migrate(session.version) {
        return Err(format!(
            "Incompatible session version: {} (supported: 1 to {})",
            session.version, SCHEMA_VERSION
        ));
    } else {
        session
    };

    // Check if session is stale (>7 days old)
    if session.is_stale(MAX_SESSION_AGE_DAYS) {
        return Err(format!(
            "Session is too old (>{} days)",
            MAX_SESSION_AGE_DAYS
        ));
    }

    Ok(session)
}

/// Initialize pending restore state with given windows (sync version).
/// Advances the generation counter and returns the new generation for timeout binding.
fn init_pending_restore_state_sync(
    windows: impl IntoIterator<Item = (String, WindowState)>,
    expected_labels: HashSet<String>,
) -> u64 {
    let pending = get_pending_restore_state();
    let mut state = lock_pending_restore(&pending);
    state.advance_and_clear();
    state.expected_labels = expected_labels;
    for (label, window_state) in windows {
        state.window_states.insert(label, window_state);
    }
    state.generation
}

/// Restore session to main window (legacy single-window restore)
///
/// Now uses pull-based approach: stores state in PendingRestoreState,
/// then emits RESTORE_START signal to trigger main window to pull its state.
pub fn restore_session(app: &AppHandle, session: SessionData) -> Result<(), String> {
    let session = prepare_session_for_restore(session)?;

    // Find the target window: prefer "main" label, fall back to first document window
    let target_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .or_else(|| {
            app.webview_windows()
                .into_iter()
                .find(|(label, _)| label.starts_with("doc-"))
                .map(|(_, w)| w)
        })
        .ok_or("No document window found for restore")?;
    let target_label = target_window.label().to_string();

    // Find main window state: prefer is_main_window, fall back to first window
    let main_state = session
        .windows
        .iter()
        .find(|w| w.is_main_window)
        .or_else(|| session.windows.first())
        .cloned()
        .ok_or("No window state in session")?;

    // Store window state for pull-based retrieval (using actual target label)
    let expected = std::iter::once(target_label.clone()).collect();
    let state_with_correct_label = WindowState {
        window_label: target_label.clone(),
        ..main_state
    };
    let gen = init_pending_restore_state_sync(
        std::iter::once((target_label.clone(), state_with_correct_label)),
        expected,
    );

    // Safety net: clear pending state after timeout to avoid memory leaks
    // if the window never calls mark_window_restore_complete
    spawn_restore_timeout(gen);

    // Emit restore signal to target window (signal only, state is pulled)
    if let Err(e) = target_window.emit(EVENT_RESTORE_START, ()) {
        // Clean up pending state to avoid memory leak since no window will pull it
        clear_pending_restore();
        return Err(format!("Failed to emit restore event: {}", e));
    }

    Ok(())
}

/// Result of multi-window restore initialization
#[derive(Serialize, Deserialize, Debug)]
pub struct RestoreMultiWindowResult {
    pub windows_created: Vec<String>,
}

/// Initialize multi-window restore
///
/// Creates secondary windows and stores session state for pull-based restoration.
/// Each window will call get_window_restore_state on startup to get its state.
///
/// Strategy: Pre-populate all state BEFORE creating windows to avoid race conditions.
/// Secondary windows are created after state is ready, then main window is signaled.
pub fn restore_session_multi_window(
    app: &AppHandle,
    session: SessionData,
) -> Result<RestoreMultiWindowResult, String> {
    let session = prepare_session_for_restore(session)?;

    // Validate main window exists BEFORE modifying state
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("Main window not found")?;

    // Find main window state: prefer is_main_window flag, fall back to first window
    let main_state = session
        .windows
        .iter()
        .find(|w| w.is_main_window)
        .or_else(|| session.windows.first())
        .cloned();

    // Collect secondary windows to create
    let secondary_windows: Vec<_> = session
        .windows
        .iter()
        .filter(|w| !w.is_main_window)
        .cloned()
        .collect();

    // Pre-calculate how many windows we'll have
    let secondary_count = secondary_windows.len();
    let mut windows_created = Vec::with_capacity(secondary_count);
    let mut window_states_to_store: Vec<(String, WindowState)> =
        Vec::with_capacity(secondary_count + 1);
    let mut expected_labels = HashSet::with_capacity(secondary_count + 1);

    // Prepare main window state — only include in expected_labels if state exists.
    // Without state, adding main to expected_labels blocks all_complete forever
    // because the frontend gets None from get_window_restore_state and never
    // calls mark_window_restore_complete.
    if let Some(state) = main_state {
        expected_labels.insert(MAIN_WINDOW_LABEL.to_string());
        let normalized = WindowState {
            window_label: MAIN_WINDOW_LABEL.to_string(),
            is_main_window: true,
            ..state
        };
        window_states_to_store.push((MAIN_WINDOW_LABEL.to_string(), normalized));
    } else {
        log::warn!("[HotExit] No main window state in session, main will restore empty");
    }

    // Phase 1: Pre-allocate labels and store state BEFORE creating windows.
    // This is crash-safe: if the app crashes after state storage but before
    // window creation, the extra state entries are harmless (unused). The
    // reverse ordering (create windows first, store state later) risks
    // windows existing with no restore state on crash.
    let mut labels_to_create = Vec::with_capacity(secondary_count);

    for window_state in secondary_windows {
        let new_label = crate::window_manager::allocate_window_label();
        let updated_state = WindowState {
            window_label: new_label.clone(),
            is_main_window: false, // Force non-main
            ..window_state
        };
        expected_labels.insert(new_label.clone());
        window_states_to_store.push((new_label.clone(), updated_state));
        labels_to_create.push(new_label);
    }

    // Store all state atomically BEFORE any windows are created
    let gen = init_pending_restore_state_sync(window_states_to_store, expected_labels);

    // Safety net: clear pending state after timeout to avoid memory leaks
    // if any window crashes or fails to call mark_window_restore_complete
    spawn_restore_timeout(gen);

    // Phase 2: Create windows with pre-allocated labels
    for label in &labels_to_create {
        match crate::window_manager::create_document_window_with_label(app, label) {
            Ok(()) => {
                windows_created.push(label.clone());
            }
            Err(e) => {
                log::error!(
                    "[HotExit] Failed to create window {} — aborting restore to preserve session: {}",
                    label, e
                );
                // Abort the whole restore rather than silently dropping this
                // window's tabs (including any dirty in-memory documents).
                // Clear the pending state (advance_and_clear bumps the
                // generation, invalidating the stale timeout task) and close any
                // already-created windows. Returning Err makes the frontend
                // invoke throw, so session.json is NOT cleared and the full
                // session is retried on the next launch (#968).
                let pending = get_pending_restore_state();
                let mut state = lock_pending_restore(&pending);
                state.advance_and_clear();
                drop(state);
                for created in &windows_created {
                    if let Some(w) = app.get_webview_window(created) {
                        let _ = w.close();
                    }
                }
                return Err(format!(
                    "Failed to create window {} during multi-window restore: {}",
                    label, e
                ));
            }
        }
    }

    // Emit restore signal to main window (signal only, state is pulled)
    if let Err(e) = main_window.emit(EVENT_RESTORE_START, ()) {
        // Clean up: pending state + orphaned secondary windows
        // Use advance_and_clear to bump generation, invalidating the stale timeout task
        let pending = get_pending_restore_state();
        let mut state = lock_pending_restore(&pending);
        state.advance_and_clear();
        drop(state);
        for label in &windows_created {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.close();
            }
        }
        return Err(format!("Failed to emit restore event to main: {}", e));
    }

    Ok(RestoreMultiWindowResult { windows_created })
}

/// Spawn a background task that clears pending restore state after a timeout.
/// This prevents memory leaks if a window crashes or never completes restoration.
///
/// Generation-safe: captures the current generation at spawn time and only
/// clears state if the generation still matches (a newer restore hasn't started).
/// Also cancels any previously running timeout task.
fn spawn_restore_timeout(generation: u64) {
    // Cancel any existing timeout task
    let handle_arc = get_timeout_handle();
    let mut handle_slot = handle_arc.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(prev) = handle_slot.take() {
        prev.abort();
    }

    // Inner body is wrapped in catch_unwind so a panic inside the cleanup
    // doesn't disappear silently — the restore-timeout task owns the
    // expected_labels invariant; a swallowed panic would leak that state.
    // We use inline catch_unwind (not spawn_logged) because the JoinHandle
    // type is tauri::async_runtime::JoinHandle in prod and tokio::task::
    // JoinHandle in test, and the handle is stored for abort().
    let future = async move {
        let body = async {
            tokio::time::sleep(Duration::from_secs(RESTORE_TIMEOUT_SECS)).await;
            let pending = get_pending_restore_state();
            let mut state = lock_pending_restore(&pending);
            // Only clear if this timeout's generation still matches current state
            if state.generation == generation && !state.expected_labels.is_empty() {
                let incomplete: Vec<_> = state
                    .expected_labels
                    .iter()
                    .filter(|l| !state.completed_windows.contains(*l))
                    .cloned()
                    .collect();
                log::warn!(
                    "[HotExit] Restore timeout ({}s) — clearing pending state. Incomplete windows: {:?}",
                    RESTORE_TIMEOUT_SECS,
                    incomplete
                );
                state.clear();
            }
        };
        if let Err(payload) =
            futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(body)).await
        {
            log::error!(
                "[task:hot-exit-restore-timeout] task panicked: {}",
                crate::task::panic_payload_message(&payload),
            );
        }
    };

    // Production: tauri::async_runtime::spawn works from any thread (no tokio context needed).
    // Tests: tokio::spawn runs on the test runtime with paused-time control.
    #[cfg(not(test))]
    let new_handle = tauri::async_runtime::spawn(future);
    #[cfg(test)]
    let new_handle = tokio::spawn(future);

    *handle_slot = Some(new_handle);
}

/// Get pending window state for restoration
///
/// Called by windows on startup to get their pending restore state.
/// Returns None if no state is pending for the given window.
pub fn get_window_restore_state(window_label: &str) -> Option<WindowState> {
    let pending = get_pending_restore_state();
    let state = lock_pending_restore(&pending);
    state.window_states.get(window_label).cloned()
}

/// Mark a window as having completed restoration
///
/// Returns true if all expected windows have completed.
/// Only counts windows that were in the expected set.
pub fn mark_window_restore_complete(window_label: &str) -> bool {
    let pending = get_pending_restore_state();
    let mut state = lock_pending_restore(&pending);

    // Only track completion for expected windows
    if state.expected_labels.contains(window_label) {
        state.completed_windows.insert(window_label.to_string());
    } else {
        log::warn!(
            "[HotExit] Ignoring completion from unexpected window: {}",
            window_label
        );
    }

    let all_done = state.all_complete();
    if all_done {
        state.clear();
    }
    all_done
}

#[cfg(test)]
#[path = "coordinator.test.rs"]
mod tests;
