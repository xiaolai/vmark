//! Partial-capture session merging — pure logic extracted from
//! `hot_exit_capture` so the data-loss-critical branches are table-testable
//! (audit 20260612 H12: this path had zero tests).
//!
//! When a capture is partial (some windows timed out during the IPC
//! broadcast), windows that were expected-but-missing are resurrected from
//! the previous session so their unsaved state isn't silently dropped on
//! restart. Windows the user intentionally closed are NOT in
//! `expected_labels` and are never resurrected.

use std::collections::HashSet;

use super::session::SessionData;

/// Refuse to merge from a previous session older than this — resurrecting
/// hour-old window state would surprise more than it saves.
const MAX_MERGE_AGE_SECS: i64 = 3600;

/// Merge a (possibly partial) fresh capture with the previous session.
///
/// - Resurrects windows that are in `expected_labels` (alive at capture
///   time) but missing from the capture (timed out), unless the previous
///   session is stale (older than [`MAX_MERGE_AGE_SECS`]), has a future
///   timestamp, or the age computation overflows.
/// - Re-sorts windows main-first whenever a merge happened.
/// - Carries the previous session's workspace forward when the capture has
///   none (workspace capture not yet implemented).
pub fn merge_partial_capture(
    mut session: SessionData,
    prev_session: Option<SessionData>,
    expected_labels: &HashSet<String>,
    now: i64,
) -> SessionData {
    let Some(prev_session) = prev_session else {
        return session;
    };

    let captured_labels: HashSet<String> = session
        .windows
        .iter()
        .map(|w| w.window_label.clone())
        .collect();

    let prev_age_secs = now.checked_sub(prev_session.timestamp);
    let is_stale = match prev_age_secs {
        Some(age) if (0..=MAX_MERGE_AGE_SECS).contains(&age) => false,
        _ => true, // overflow, negative (future timestamp), or too old
    };

    let mut merged = false;
    if is_stale {
        log::debug!(
            "[HotExit] Skipping stale merge: previous session age {:?}s (max {}s)",
            prev_age_secs,
            MAX_MERGE_AGE_SECS
        );
    } else {
        for prev_window in prev_session.windows {
            if expected_labels.contains(&prev_window.window_label)
                && !captured_labels.contains(&prev_window.window_label)
            {
                log::debug!(
                    "[HotExit] Merging previous state for timed-out window '{}' ({:?}s old)",
                    prev_window.window_label,
                    prev_age_secs
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

    session
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hot_exit::session::{
        DocumentState, SessionData, TabState, UiState, WindowState, WorkspaceState,
    };

    const NOW: i64 = 1_760_000_000;

    fn make_ui_state() -> UiState {
        UiState {
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
        }
    }

    fn make_tab(id: &str) -> TabState {
        TabState {
            id: id.to_string(),
            file_path: None,
            title: format!("Tab {}", id),
            is_pinned: false,
            document: DocumentState {
                content: format!("content of {}", id),
                saved_content: String::new(),
                is_dirty: true,
                is_missing: false,
                is_divergent: false,
                line_ending: "\n".to_string(),
                cursor_info: None,
                last_modified_timestamp: None,
                is_untitled: true,
                untitled_number: Some(1),
                is_read_only: false,
                undo_history: Vec::new(),
                redo_history: Vec::new(),
                mode: None,
                hard_break_style: None,
                last_disk_content: None,
            },
            format_id: "markdown".to_string(),
            editing_enabled: true,
            active_schema_id: None,
        }
    }

    fn make_window(label: &str) -> WindowState {
        WindowState {
            window_label: label.to_string(),
            is_main_window: label == "main",
            active_tab_id: None,
            tabs: vec![make_tab(&format!("tab-{}", label))],
            ui_state: make_ui_state(),
            geometry: None,
        }
    }

    fn make_session(timestamp: i64, labels: &[&str]) -> SessionData {
        SessionData {
            version: 3,
            timestamp,
            vmark_version: "0.0.0-test".to_string(),
            windows: labels.iter().map(|l| make_window(l)).collect(),
            workspace: None,
        }
    }

    fn labels(s: &SessionData) -> Vec<&str> {
        s.windows.iter().map(|w| w.window_label.as_str()).collect()
    }

    fn expected(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_previous_session_returns_capture_unchanged() {
        let session = make_session(NOW, &["main"]);
        let out = merge_partial_capture(session, None, &expected(&["main"]), NOW);
        assert_eq!(labels(&out), vec!["main"]);
    }

    #[test]
    fn timed_out_expected_window_is_resurrected() {
        let session = make_session(NOW, &["main"]);
        let prev = make_session(NOW - 60, &["main", "window-2"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main", "window-2"]);
    }

    #[test]
    fn intentionally_closed_window_is_not_resurrected() {
        // window-2 exists in the previous session but was closed by the
        // user before capture — it is NOT in expected_labels.
        let session = make_session(NOW, &["main"]);
        let prev = make_session(NOW - 60, &["main", "window-2"]);
        let out = merge_partial_capture(session, Some(prev), &expected(&["main"]), NOW);
        assert_eq!(labels(&out), vec!["main"]);
    }

    #[test]
    fn captured_window_is_never_overwritten_by_previous_state() {
        let mut session = make_session(NOW, &["main", "window-2"]);
        session.windows[1].tabs[0].document.content = "fresh".into();
        let mut prev = make_session(NOW - 60, &["main", "window-2"]);
        prev.windows[1].tabs[0].document.content = "stale".into();
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(out.windows.len(), 2);
        assert_eq!(out.windows[1].tabs[0].document.content, "fresh");
    }

    #[test]
    fn stale_previous_session_is_not_merged() {
        let session = make_session(NOW, &["main"]);
        let prev = make_session(NOW - MAX_MERGE_AGE_SECS - 1, &["main", "window-2"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main"]);
    }

    #[test]
    fn boundary_age_exactly_max_is_still_merged() {
        let session = make_session(NOW, &["main"]);
        let prev = make_session(NOW - MAX_MERGE_AGE_SECS, &["main", "window-2"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main", "window-2"]);
    }

    #[test]
    fn future_timestamped_previous_session_is_not_merged() {
        let session = make_session(NOW, &["main"]);
        let prev = make_session(NOW + 120, &["main", "window-2"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main"]);
    }

    #[test]
    fn overflowing_age_is_not_merged() {
        let session = make_session(NOW, &["main"]);
        let prev = make_session(i64::MIN, &["main", "window-2"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main"]);
    }

    #[test]
    fn merged_windows_sort_main_first_then_by_label() {
        // Fresh capture got only the secondary windows; main timed out.
        let session = make_session(NOW, &["window-3", "window-2"]);
        let prev = make_session(NOW - 10, &["main"]);
        let out = merge_partial_capture(
            session,
            Some(prev),
            &expected(&["main", "window-2", "window-3"]),
            NOW,
        );
        assert_eq!(labels(&out), vec!["main", "window-2", "window-3"]);
    }

    #[test]
    fn workspace_carries_over_when_capture_has_none() {
        let session = make_session(NOW, &["main"]);
        let mut prev = make_session(NOW - 10, &["main"]);
        prev.workspace = Some(WorkspaceState {
            root_path: Some("/tmp/ws".to_string()),
            is_workspace_mode: true,
            show_hidden_files: false,
        });
        let out = merge_partial_capture(session, Some(prev), &expected(&["main"]), NOW);
        assert_eq!(
            out.workspace.and_then(|w| w.root_path).as_deref(),
            Some("/tmp/ws")
        );
    }

    #[test]
    fn workspace_carries_over_even_when_previous_session_is_stale() {
        // Staleness gates window resurrection, not workspace carry-over —
        // matches the pre-extraction behavior of hot_exit_capture.
        let session = make_session(NOW, &["main"]);
        let mut prev = make_session(NOW - MAX_MERGE_AGE_SECS - 999, &["main"]);
        prev.workspace = Some(WorkspaceState {
            root_path: Some("/tmp/old-ws".to_string()),
            is_workspace_mode: true,
            show_hidden_files: false,
        });
        let out = merge_partial_capture(session, Some(prev), &expected(&["main"]), NOW);
        assert_eq!(
            out.workspace.and_then(|w| w.root_path).as_deref(),
            Some("/tmp/old-ws")
        );
    }
}
