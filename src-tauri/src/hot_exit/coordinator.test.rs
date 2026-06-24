//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;

// Tests mutate a global OnceLock, so they must run serially.
// Use unwrap_or_else to recover from poisoning (a panicking test must not
// cascade failures to all subsequent tests).
static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn acquire_test_lock() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

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
            terminal_visible: false,
            terminal_height: 250,
        },
        geometry: None, workspace_instance_ids: Vec::new(), active_workspace_instance_id: None, workspace_instances: Vec::new(),
    }
}

// -- PendingRestoreState ---------------------------------------------------

#[test]
fn pending_restore_state_all_complete_empty() {
    let _lock = acquire_test_lock();
    let state = PendingRestoreState::default();
    // Empty expected_labels → not complete (guard against vacuous truth)
    assert!(!state.all_complete());
}

#[test]
fn pending_restore_state_all_complete_partial() {
    let _lock = acquire_test_lock();
    let mut state = PendingRestoreState::default();
    state.expected_labels.insert("main".to_string());
    state.expected_labels.insert("doc-1".to_string());
    state.completed_windows.insert("main".to_string());
    assert!(!state.all_complete());
}

#[test]
fn pending_restore_state_all_complete_full() {
    let _lock = acquire_test_lock();
    let mut state = PendingRestoreState::default();
    state.expected_labels.insert("main".to_string());
    state.expected_labels.insert("doc-1".to_string());
    state.completed_windows.insert("main".to_string());
    state.completed_windows.insert("doc-1".to_string());
    assert!(state.all_complete());
}

#[test]
fn pending_restore_state_clear() {
    let _lock = acquire_test_lock();
    let mut state = PendingRestoreState::default();
    state.expected_labels.insert("main".to_string());
    state.window_states.insert("main".to_string(), make_window_state("main", true));
    state.completed_windows.insert("main".to_string());
    state.clear();
    assert!(state.expected_labels.is_empty());
    assert!(state.window_states.is_empty());
    assert!(state.completed_windows.is_empty());
}

// -- generate_capture_id ---------------------------------------------------

#[test]
fn capture_ids_are_unique_within_same_millisecond() {
    let _lock = acquire_test_lock();
    // Two IDs generated back-to-back (almost certainly the same
    // millisecond) must differ — the bug was a timestamp-only ID where
    // captures started in the same millisecond could accept each other's
    // responses. The atomic sequence suffix guarantees uniqueness.
    let mut ids = HashSet::new();
    for _ in 0..1000 {
        assert!(
            ids.insert(generate_capture_id()),
            "generate_capture_id produced a duplicate ID within a tight loop"
        );
    }
}

#[test]
fn capture_id_has_expected_shape() {
    let _lock = acquire_test_lock();
    let id = generate_capture_id();
    assert!(id.starts_with("capture-"), "got {id}");
    // capture-<millis>-<seq>: three dash-separated segments after prefix.
    let parts: Vec<&str> = id.split('-').collect();
    assert_eq!(parts.len(), 3, "expected capture-<millis>-<seq>, got {id}");
    assert!(parts[1].parse::<i64>().is_ok(), "millis segment: {id}");
    assert!(parts[2].parse::<u64>().is_ok(), "seq segment: {id}");
}

// -- sort_windows_deterministically / assemble_session ---------------------

#[test]
fn assemble_session_sorts_main_first_then_by_label() {
    let _lock = acquire_test_lock();
    let windows = vec![
        make_window_state("doc-3", false),
        make_window_state("main", true),
        make_window_state("doc-1", false),
    ];
    let session = assemble_session(windows);
    let labels: Vec<&str> = session
        .windows
        .iter()
        .map(|w| w.window_label.as_str())
        .collect();
    assert_eq!(labels, vec!["main", "doc-1", "doc-3"]);
    assert_eq!(session.version, SCHEMA_VERSION);
    assert!(session.workspace.is_none());
}

// -- normalize_window_label ------------------------------------------------

#[test]
fn normalize_matching_label_is_noop() {
    let _lock = acquire_test_lock();
    let mut ws = make_window_state("main", true);
    normalize_window_label(&mut ws, "main");
    assert_eq!(ws.window_label, "main");
}

#[test]
fn normalize_mismatched_label_updates() {
    let _lock = acquire_test_lock();
    let mut ws = make_window_state("old-label", false);
    normalize_window_label(&mut ws, "doc-5");
    assert_eq!(ws.window_label, "doc-5");
}

// -- Global state functions ------------------------------------------------

#[test]
fn store_and_retrieve_window_state() {
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
    clear_pending_restore();

    let result = get_window_restore_state("nonexistent");
    assert!(result.is_none());
}

#[test]
fn mark_complete_tracks_expected_only() {
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
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
    let _lock = acquire_test_lock();
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

// -- Generation counter ---------------------------------------------------

#[test]
fn init_advances_generation() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    let expected1: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen1 = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected1,
    );

    let expected2: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen2 = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected2,
    );

    assert!(gen2 > gen1, "Generation must advance on each init");
}

#[test]
fn generation_preserved_across_clear() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    let expected: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected,
    );

    // clear() preserves generation
    let pending = get_pending_restore_state();
    {
        let mut state = lock_pending_restore(&pending);
        state.clear();
        assert_eq!(state.generation, gen, "clear() must preserve generation");
    }

    // advance_and_clear() bumps it
    {
        let mut state = lock_pending_restore(&pending);
        state.advance_and_clear();
        assert!(state.generation > gen, "advance_and_clear() must bump generation");
    }
}

#[test]
fn stale_generation_would_not_clear_new_state() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    // Simulate restore A
    let expected_a: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen_a = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected_a,
    );

    // Simulate restore B (overwrites A)
    let expected_b: HashSet<String> = ["main".to_string(), "doc-1".to_string()].into_iter().collect();
    let gen_b = init_pending_restore_state_sync(
        [
            ("main".to_string(), make_window_state("main", true)),
            ("doc-1".to_string(), make_window_state("doc-1", false)),
        ],
        expected_b,
    );

    // A stale timeout from restore A should NOT clear restore B's state
    let pending = get_pending_restore_state();
    let mut state = lock_pending_restore(&pending);
    assert_ne!(gen_a, gen_b);
    assert_ne!(state.generation, gen_a);
    // Simulate what the timeout task does: check generation before clearing
    if state.generation == gen_a {
        state.clear(); // This should NOT execute
    }
    // State B must still be intact
    assert_eq!(state.expected_labels.len(), 2);
    assert!(state.window_states.contains_key("doc-1"));
}

// -- Async timeout tests (tokio paused time) ------------------------------

/// Helper: let spawned tasks register timers, advance time, then flush.
/// The initial yield lets spawned tasks poll once to register their sleep
/// with the time driver (required for paused time to work correctly).
async fn yield_advance_flush(duration: Duration) {
    // Let spawned tasks register their timers
    tokio::task::yield_now().await;
    // Advance past the timer deadline
    tokio::time::advance(duration).await;
    // Let the now-resolved tasks run to completion
    tokio::task::yield_now().await;
}

#[tokio::test(start_paused = true)]
async fn timeout_clears_incomplete_restore() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    let expected: HashSet<String> = ["main".to_string(), "doc-1".to_string()].into_iter().collect();
    let gen = init_pending_restore_state_sync(
        [
            ("main".to_string(), make_window_state("main", true)),
            ("doc-1".to_string(), make_window_state("doc-1", false)),
        ],
        expected,
    );

    // Only mark main as complete — doc-1 never completes
    mark_window_restore_complete("main");

    // Spawn timeout and advance time past the deadline
    spawn_restore_timeout(gen);
    yield_advance_flush(Duration::from_secs(RESTORE_TIMEOUT_SECS + 1)).await;

    // State should be cleared by timeout
    let pending = get_pending_restore_state();
    let state = lock_pending_restore(&pending);
    assert!(state.expected_labels.is_empty(), "Timeout must clear incomplete state");
    assert!(state.window_states.is_empty());
}

#[tokio::test(start_paused = true)]
async fn timeout_skips_already_completed_restore() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    let expected: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected,
    );

    // Complete restore before timeout fires
    let all_done = mark_window_restore_complete("main");
    assert!(all_done);

    // Spawn timeout and advance time
    spawn_restore_timeout(gen);
    yield_advance_flush(Duration::from_secs(RESTORE_TIMEOUT_SECS + 1)).await;

    // State was already cleared by completion — timeout is a no-op
    let pending = get_pending_restore_state();
    let state = lock_pending_restore(&pending);
    assert!(state.expected_labels.is_empty());
}

#[tokio::test(start_paused = true)]
async fn new_restore_cancels_old_timeout() {
    let _lock = acquire_test_lock();
    clear_pending_restore();

    // Restore A
    let expected_a: HashSet<String> = ["main".to_string()].into_iter().collect();
    let gen_a = init_pending_restore_state_sync(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        expected_a,
    );
    spawn_restore_timeout(gen_a);

    // Before timeout fires, start restore B
    yield_advance_flush(Duration::from_secs(30)).await;
    let expected_b: HashSet<String> = ["main".to_string(), "doc-1".to_string()].into_iter().collect();
    let gen_b = init_pending_restore_state_sync(
        [
            ("main".to_string(), make_window_state("main", true)),
            ("doc-1".to_string(), make_window_state("doc-1", false)),
        ],
        expected_b,
    );
    spawn_restore_timeout(gen_b); // Cancels restore A's timeout

    // Advance past restore A's original timeout (60s from start = 30s more)
    yield_advance_flush(Duration::from_secs(31)).await;

    // Restore B's state must NOT have been cleared (A's timeout was cancelled)
    let pending = get_pending_restore_state();
    let state = lock_pending_restore(&pending);
    assert_eq!(state.expected_labels.len(), 2, "Restore B state must survive A's cancelled timeout");
    assert!(state.window_states.contains_key("doc-1"));
}
