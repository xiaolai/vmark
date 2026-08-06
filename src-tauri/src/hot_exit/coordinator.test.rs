//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).
//!
//! WI-20 removed this file's `TEST_LOCK`: the pending-restore map is no longer
//! a process-global `OnceLock`, so tests that touch it own their own
//! `HotExitState` and need no serialization against each other. What remains
//! here is capture-side and session-preparation logic; the restore state's own
//! behavior lives in `state.test.rs` and `coordinator_pins.test.rs`.

use super::*;

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
        geometry: None,
        workspace_instance_ids: Vec::new(),
        active_workspace_instance_id: None,
        workspace_instances: Vec::new(),
        ui_state_by_instance: None,
        closed_tab_scopes: None,
        browser_session: None,
    }
}

// -- generate_capture_id ---------------------------------------------------

#[test]
fn capture_ids_are_unique_within_same_millisecond() {
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
    let mut ws = make_window_state("main", true);
    normalize_window_label(&mut ws, "main");
    assert_eq!(ws.window_label, "main");
}

#[test]
fn normalize_mismatched_label_updates() {
    let mut ws = make_window_state("old-label", false);
    normalize_window_label(&mut ws, "doc-5");
    assert_eq!(ws.window_label, "doc-5");
}

// -- prepare_session_for_restore -------------------------------------------

#[test]
fn prepare_session_valid() {
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
    let state = HotExitState::default();

    // Simulate the atomic restore pattern: pre-allocate labels and store
    // state BEFORE any windows are created (crash safety invariant).
    let labels: Vec<String> = (0..3).map(|i| format!("doc-{}", 100 + i)).collect();
    let mut states = Vec::new();
    let mut expected = HashSet::new();

    expected.insert(MAIN_WINDOW_LABEL.to_string());
    states.push((
        MAIN_WINDOW_LABEL.to_string(),
        make_window_state(MAIN_WINDOW_LABEL, true),
    ));

    for label in &labels {
        expected.insert(label.clone());
        states.push((label.clone(), make_window_state(label, false)));
    }

    state.store(states, expected);

    // All state must be queryable immediately (before windows exist)
    assert!(state.window_state(MAIN_WINDOW_LABEL).is_some());
    for label in &labels {
        let stored = state
            .window_state(label)
            .unwrap_or_else(|| panic!("State must be available for pre-allocated label {}", label));
        assert_eq!(stored.window_label, *label);
        assert!(!stored.is_main_window);
    }
}

// -- Restore timeout (tokio paused time) ----------------------------------
//
// These drive `restore_timeout_body` directly rather than the `spawn_` wrapper
// around it. That is what removed the `#[cfg(test)]` fork of the JoinHandle
// type: production spawns on the Tauri runtime (restore runs from a sync
// command, with no ambient tokio runtime), tests await the body under
// `start_paused` time, and neither needs to know about the other.

#[tokio::test(start_paused = true)]
async fn the_timeout_clears_a_restore_that_never_completed() {
    let state = HotExitState::default();
    let round = state.store(
        [
            ("main".to_string(), make_window_state("main", true)),
            ("doc-1".to_string(), make_window_state("doc-1", false)),
        ],
        ["main".to_string(), "doc-1".to_string()]
            .into_iter()
            .collect(),
    );
    // Only main reports back; doc-1 never does.
    state.mark_complete("main");

    restore_timeout_body(&state, round).await;

    assert!(
        state.window_state("main").is_none() && state.window_state("doc-1").is_none(),
        "an incomplete restore must not hold a session's tabs for the life of the process"
    );
}

#[tokio::test(start_paused = true)]
async fn the_timeout_leaves_a_completed_restore_alone() {
    let state = HotExitState::default();
    let round = state.store(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        std::iter::once("main".to_string()).collect(),
    );
    assert!(state.mark_complete("main"), "completed before the deadline");

    // A later restore stored something new; the finished round's timeout must
    // not touch it.
    state.store(
        std::iter::once(("doc-9".to_string(), make_window_state("doc-9", false))),
        std::iter::once("doc-9".to_string()).collect(),
    );

    restore_timeout_body(&state, round).await;

    assert!(
        state.window_state("doc-9").is_some(),
        "a stale timeout must not clear the restore that superseded it"
    );
}

#[tokio::test(start_paused = true)]
async fn the_timeout_waits_the_full_window_before_clearing() {
    let state = HotExitState::default();
    let round = state.store(
        std::iter::once(("main".to_string(), make_window_state("main", true))),
        std::iter::once("main".to_string()).collect(),
    );

    let started = tokio::time::Instant::now();
    restore_timeout_body(&state, round).await;

    assert!(
        started.elapsed() >= Duration::from_secs(RESTORE_TIMEOUT_SECS),
        "the safety net must not fire early — a slow window would lose its tabs"
    );
    assert!(state.window_state("main").is_none());
}
