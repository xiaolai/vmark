//! Coordinator for hot exit capture and restore
//!
//! Orchestrates multi-window capture with timeout and restore logic.
//! Supports multi-window restoration with pull-based state retrieval.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::time::{timeout, Duration};
use tauri::{AppHandle, Emitter, Listener, Manager};
use serde::{Deserialize, Serialize};
use super::session::{SessionData, WindowState, SCHEMA_VERSION, MAX_SESSION_AGE_DAYS};
use super::migration::{can_migrate, migrate_session, needs_migration};
use super::{EVENT_CAPTURE_REQUEST, EVENT_CAPTURE_RESPONSE, EVENT_CAPTURE_TIMEOUT, EVENT_RESTORE_START, MAIN_WINDOW_LABEL};

/// Polling interval for waiting on responses
const RESPONSE_POLL_INTERVAL_MS: u64 = 100;

/// Capture timeout in seconds
const CAPTURE_TIMEOUT_SECS: u64 = 5;

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
}

impl PendingRestoreState {
    /// Check if all expected windows have completed
    fn all_complete(&self) -> bool {
        !self.expected_labels.is_empty()
            && self.expected_labels.iter().all(|label| self.completed_windows.contains(label))
    }

    /// Clear all state
    fn clear(&mut self) {
        self.window_states.clear();
        self.expected_labels.clear();
        self.completed_windows.clear();
    }
}

/// Global pending restore state
static PENDING_RESTORE: OnceLock<Arc<Mutex<PendingRestoreState>>> = OnceLock::new();

/// Get the pending restore state (for internal use)
pub(crate) fn get_pending_restore_state() -> Arc<Mutex<PendingRestoreState>> {
    Arc::clone(
        PENDING_RESTORE.get_or_init(|| Arc::new(Mutex::new(PendingRestoreState::default())))
    )
}

/// Lock the pending restore state, recovering from poisoning
fn lock_pending_restore(pending: &Arc<Mutex<PendingRestoreState>>) -> std::sync::MutexGuard<'_, PendingRestoreState> {
    pending.lock().unwrap_or_else(|poisoned| {
        eprintln!("[HotExit] Recovering from poisoned mutex");
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

/// Coordinator state for collecting window responses
struct CaptureState {
    capture_id: String,
    expected_windows: HashSet<String>,
    responses: HashMap<String, WindowState>,
}

/// Normalize window state label to match expected label
fn normalize_window_label(state: &mut WindowState, expected_label: &str) {
    if state.window_label != expected_label {
        eprintln!(
            "[HotExit] Normalizing mismatched window_label: {} -> {}",
            state.window_label,
            expected_label
        );
        state.window_label = expected_label.to_string();
    }
}

/// Capture session from all windows
pub async fn capture_session(app: &AppHandle) -> Result<SessionData, String> {
    // Get all document windows (main + doc-*)
    let windows: Vec<String> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, _)| {
            if label == MAIN_WINDOW_LABEL || label.starts_with("doc-") {
                Some(label)
            } else {
                None
            }
        })
        .collect();

    if windows.is_empty() {
        return Err("No document windows to capture".to_string());
    }

    // Generate unique capture ID for this request
    let capture_id = format!("capture-{}", chrono::Utc::now().timestamp_millis());

    // Use std::sync::Mutex (not tokio::sync::Mutex) because the listener callback
    // runs on the tokio runtime and blocking_lock() would panic
    let state = Arc::new(Mutex::new(CaptureState {
        capture_id: capture_id.clone(),
        expected_windows: windows.iter().cloned().collect(),
        responses: HashMap::new(),
    }));

    // Listen for responses
    let state_clone = state.clone();
    let unlisten = app.listen(EVENT_CAPTURE_RESPONSE, move |event| {
        match serde_json::from_str::<CaptureResponse>(event.payload()) {
            Ok(mut response) => {
                let mut state = state_clone.lock().unwrap_or_else(|poisoned| {
                    eprintln!("[HotExit] Recovering from poisoned capture state mutex");
                    poisoned.into_inner()
                });

                // Ignore responses from different capture requests (stale responses)
                if response.capture_id != state.capture_id {
                    eprintln!(
                        "[HotExit] Ignoring stale response (capture_id mismatch: {} vs {})",
                        response.capture_id,
                        state.capture_id
                    );
                    return;
                }

                // Only accept responses from expected windows
                if !state.expected_windows.contains(&response.window_label) {
                    eprintln!(
                        "[HotExit] Ignoring response from unexpected window: {}",
                        response.window_label
                    );
                    return;
                }

                // Ignore duplicate responses from the same window
                if state.responses.contains_key(&response.window_label) {
                    eprintln!(
                        "[HotExit] Ignoring duplicate response from window: {}",
                        response.window_label
                    );
                    return;
                }

                // Normalize: ensure state.window_label matches the response key
                normalize_window_label(&mut response.state, &response.window_label);

                state.responses.insert(response.window_label.clone(), response.state);
            }
            Err(e) => {
                eprintln!(
                    "[HotExit] Failed to parse capture response ({}): {}",
                    event.payload().len(),
                    e
                );
            }
        }
    });

    // Broadcast capture request with capture_id - ensure unlisten on failure
    let request = CaptureRequest { capture_id };
    if let Err(e) = app.emit(EVENT_CAPTURE_REQUEST, &request) {
        app.unlisten(unlisten);
        return Err(format!("Failed to emit capture request: {}", e));
    }

    // Wait for responses with timeout
    let result = timeout(
        Duration::from_secs(CAPTURE_TIMEOUT_SECS),
        wait_for_all_responses(state.clone(), windows.len()),
    )
    .await;

    // Always unlisten after waiting
    app.unlisten(unlisten);

    let final_state = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    // Check if we got enough responses
    let got_responses = final_state.responses.len();
    let expected_responses = final_state.expected_windows.len();

    if result.is_err() {
        // Timeout occurred
        eprintln!(
            "[HotExit] Timeout: Got {}/{} window responses",
            got_responses,
            expected_responses
        );
        if let Err(e) = app.emit(EVENT_CAPTURE_TIMEOUT, ()) {
            eprintln!("[HotExit] Failed to emit capture timeout event: {}", e);
        }

        // If we got zero responses, this is a critical failure
        if got_responses == 0 {
            return Err("Capture timeout: no windows responded".to_string());
        }
    }

    // Build session from collected responses, sorted deterministically
    let mut windows_vec: Vec<WindowState> = final_state.responses.values().cloned().collect();
    windows_vec.sort_by(|a, b| {
        // Main window first, then by label
        match (a.is_main_window, b.is_main_window) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.window_label.cmp(&b.window_label),
        }
    });

    let session = SessionData {
        version: SCHEMA_VERSION,
        timestamp: chrono::Utc::now().timestamp(),
        vmark_version: env!("CARGO_PKG_VERSION").to_string(),
        windows: windows_vec,
        workspace: None, // Workspace capture not yet implemented
    };

    Ok(session)
}

async fn wait_for_all_responses(state: Arc<Mutex<CaptureState>>, expected: usize) {
    loop {
        {
            let current = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
        eprintln!(
            "[HotExit] Migrating session from v{} to v{}",
            session.version, SCHEMA_VERSION
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
        return Err(format!("Session is too old (>{} days)", MAX_SESSION_AGE_DAYS));
    }

    Ok(session)
}

/// Initialize pending restore state with given windows (sync version)
fn init_pending_restore_state_sync(
    windows: impl IntoIterator<Item = (String, WindowState)>,
    expected_labels: HashSet<String>,
) {
    let pending = get_pending_restore_state();
    let mut state = lock_pending_restore(&pending);
    state.clear();
    state.expected_labels = expected_labels;
    for (label, window_state) in windows {
        state.window_states.insert(label, window_state);
    }
}

/// Restore session to main window (legacy single-window restore)
///
/// Now uses pull-based approach: stores state in PendingRestoreState,
/// then emits RESTORE_START signal to trigger main window to pull its state.
pub fn restore_session(
    app: &AppHandle,
    session: SessionData,
) -> Result<(), String> {
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
    init_pending_restore_state_sync(
        std::iter::once((target_label.clone(), state_with_correct_label)),
        expected,
    );

    // Emit restore signal to target window (signal only, state is pulled)
    target_window
        .emit(EVENT_RESTORE_START, ())
        .map_err(|e| format!("Failed to emit restore event: {}", e))?;

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
    let mut window_states_to_store: Vec<(String, WindowState)> = Vec::with_capacity(secondary_count + 1);
    let mut expected_labels = HashSet::with_capacity(secondary_count + 1);

    // Always include main in expected_labels (even if session doesn't have main state)
    expected_labels.insert(MAIN_WINDOW_LABEL.to_string());

    // Prepare main window state
    if let Some(state) = main_state {
        let normalized = WindowState {
            window_label: MAIN_WINDOW_LABEL.to_string(),
            is_main_window: true,
            ..state
        };
        window_states_to_store.push((MAIN_WINDOW_LABEL.to_string(), normalized));
    } else {
        eprintln!("[HotExit] Warning: No main window state in session, main will restore empty");
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
    init_pending_restore_state_sync(window_states_to_store, expected_labels);

    // Phase 2: Create windows with pre-allocated labels
    for label in &labels_to_create {
        match crate::window_manager::create_document_window_with_label(app, label) {
            Ok(()) => {
                windows_created.push(label.clone());
            }
            Err(e) => {
                eprintln!(
                    "[HotExit] Failed to create window {}: {}",
                    label, e
                );
                // State was stored but window creation failed — harmless.
                // The unused state entry will be ignored.
            }
        }
    }

    // Emit restore signal to main window (signal only, state is pulled)
    main_window
        .emit(EVENT_RESTORE_START, ())
        .map_err(|e| format!("Failed to emit restore event to main: {}", e))?;

    Ok(RestoreMultiWindowResult { windows_created })
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
        eprintln!(
            "[HotExit] Ignoring completion from unexpected window: {}",
            window_label
        );
    }

    state.all_complete()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests mutate a global OnceLock, so they must run serially.
    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn make_window_state(label: &str, is_main: bool) -> WindowState {
        WindowState {
            window_label: label.to_string(),
            is_main_window: is_main,
            active_tab_id: None,
            tabs: vec![],
            ui_state: super::super::session::UiState {
                sidebar_visible: true,
                sidebar_width: 260,
                outline_visible: false,
                sidebar_view_mode: "files".to_string(),
                status_bar_visible: true,
                source_mode_enabled: false,
                focus_mode_enabled: false,
                typewriter_mode_enabled: false,
            },
            geometry: None,
        }
    }

    // -- PendingRestoreState ---------------------------------------------------

    #[test]
    fn pending_restore_state_all_complete_empty() {
        let _lock = TEST_LOCK.lock().unwrap();
        let state = PendingRestoreState::default();
        // Empty expected_labels → not complete (guard against vacuous truth)
        assert!(!state.all_complete());
    }

    #[test]
    fn pending_restore_state_all_complete_partial() {
        let _lock = TEST_LOCK.lock().unwrap();
        let mut state = PendingRestoreState::default();
        state.expected_labels.insert("main".to_string());
        state.expected_labels.insert("doc-1".to_string());
        state.completed_windows.insert("main".to_string());
        assert!(!state.all_complete());
    }

    #[test]
    fn pending_restore_state_all_complete_full() {
        let _lock = TEST_LOCK.lock().unwrap();
        let mut state = PendingRestoreState::default();
        state.expected_labels.insert("main".to_string());
        state.expected_labels.insert("doc-1".to_string());
        state.completed_windows.insert("main".to_string());
        state.completed_windows.insert("doc-1".to_string());
        assert!(state.all_complete());
    }

    #[test]
    fn pending_restore_state_clear() {
        let _lock = TEST_LOCK.lock().unwrap();
        let mut state = PendingRestoreState::default();
        state.expected_labels.insert("main".to_string());
        state.window_states.insert("main".to_string(), make_window_state("main", true));
        state.completed_windows.insert("main".to_string());
        state.clear();
        assert!(state.expected_labels.is_empty());
        assert!(state.window_states.is_empty());
        assert!(state.completed_windows.is_empty());
    }

    // -- normalize_window_label ------------------------------------------------

    #[test]
    fn normalize_matching_label_is_noop() {
        let _lock = TEST_LOCK.lock().unwrap();
        let mut ws = make_window_state("main", true);
        normalize_window_label(&mut ws, "main");
        assert_eq!(ws.window_label, "main");
    }

    #[test]
    fn normalize_mismatched_label_updates() {
        let _lock = TEST_LOCK.lock().unwrap();
        let mut ws = make_window_state("old-label", false);
        normalize_window_label(&mut ws, "doc-5");
        assert_eq!(ws.window_label, "doc-5");
    }

    // -- Global state functions ------------------------------------------------

    #[test]
    fn store_and_retrieve_window_state() {
        let _lock = TEST_LOCK.lock().unwrap();
        clear_pending_restore();

        let ws = make_window_state("main", true);
        let expected: HashSet<String> = ["main".to_string()].into_iter().collect();
        init_pending_restore_state_sync(
            std::iter::once(("main".to_string(), ws.clone())),
            expected,
        );

        let retrieved = get_window_restore_state("main");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().window_label, "main");
    }

    #[test]
    fn retrieve_nonexistent_window_returns_none() {
        let _lock = TEST_LOCK.lock().unwrap();
        clear_pending_restore();

        let result = get_window_restore_state("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn mark_complete_tracks_expected_only() {
        let _lock = TEST_LOCK.lock().unwrap();
        clear_pending_restore();

        let expected: HashSet<String> = ["main".to_string(), "doc-1".to_string()].into_iter().collect();
        init_pending_restore_state_sync(
            [
                ("main".to_string(), make_window_state("main", true)),
                ("doc-1".to_string(), make_window_state("doc-1", false)),
            ],
            expected,
        );

        // Unexpected window is ignored
        assert!(!mark_window_restore_complete("unknown"));

        // First expected window
        assert!(!mark_window_restore_complete("main"));

        // Second expected window — now all complete
        assert!(mark_window_restore_complete("doc-1"));
    }

    #[test]
    fn clear_pending_restore_resets_state() {
        let _lock = TEST_LOCK.lock().unwrap();
        clear_pending_restore();

        let expected: HashSet<String> = ["main".to_string()].into_iter().collect();
        init_pending_restore_state_sync(
            std::iter::once(("main".to_string(), make_window_state("main", true))),
            expected,
        );
        assert!(get_window_restore_state("main").is_some());

        clear_pending_restore();
        assert!(get_window_restore_state("main").is_none());
    }

    // -- prepare_session_for_restore -------------------------------------------

    #[test]
    fn prepare_session_valid() {
        let _lock = TEST_LOCK.lock().unwrap();
        let session = SessionData {
            version: SCHEMA_VERSION,
            timestamp: chrono::Utc::now().timestamp(),
            vmark_version: "0.4.38".to_string(),
            windows: vec![],
            workspace: None,
        };
        assert!(prepare_session_for_restore(session).is_ok());
    }

    #[test]
    fn prepare_session_stale_rejected() {
        let _lock = TEST_LOCK.lock().unwrap();
        let stale_timestamp = chrono::Utc::now().timestamp() - (8 * 86_400); // 8 days ago
        let session = SessionData {
            version: SCHEMA_VERSION,
            timestamp: stale_timestamp,
            vmark_version: "0.4.38".to_string(),
            windows: vec![],
            workspace: None,
        };
        let result = prepare_session_for_restore(session);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too old"));
    }

    #[test]
    fn prepare_session_incompatible_version_rejected() {
        let _lock = TEST_LOCK.lock().unwrap();
        let session = SessionData {
            version: 999,
            timestamp: chrono::Utc::now().timestamp(),
            vmark_version: "0.4.38".to_string(),
            windows: vec![],
            workspace: None,
        };
        let result = prepare_session_for_restore(session);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Incompatible"));
    }

    // -- Pre-store invariant (crash safety) -----------------------------------

    #[test]
    fn pre_stored_state_queryable_for_pre_allocated_labels() {
        let _lock = TEST_LOCK.lock().unwrap();
        clear_pending_restore();

        // Simulate the atomic restore pattern: pre-allocate labels and store
        // state BEFORE any windows are created (crash safety invariant).
        let labels: Vec<String> = (0..3).map(|i| format!("doc-{}", 100 + i)).collect();
        let mut states = Vec::new();
        let mut expected = HashSet::new();

        expected.insert(MAIN_WINDOW_LABEL.to_string());
        states.push((MAIN_WINDOW_LABEL.to_string(), make_window_state(MAIN_WINDOW_LABEL, true)));

        for label in &labels {
            expected.insert(label.clone());
            states.push((label.clone(), make_window_state(label, false)));
        }

        init_pending_restore_state_sync(states, expected);

        // All state must be queryable immediately (before windows exist)
        assert!(get_window_restore_state(MAIN_WINDOW_LABEL).is_some());
        for label in &labels {
            let state = get_window_restore_state(label)
                .unwrap_or_else(|| panic!("State must be available for pre-allocated label {}", label));
            assert_eq!(state.window_label, *label);
            assert!(!state.is_main_window);
        }
    }
}
