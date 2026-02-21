//! Structural validation and auto-repair for deserialized session data
//!
//! Validates internal consistency of SessionData after JSON deserialization.
//! Repairs common issues (duplicate tab IDs, invalid active_tab_id) with warnings
//! rather than failing, so sessions are never silently lost.
//!
//! @coordinates-with storage.rs (called after deserialization in read_session)
//! @coordinates-with session.rs (operates on SessionData structs)

use std::collections::HashSet;

use super::session::SessionData;

/// Validate and auto-repair a deserialized session.
///
/// Returns a list of warnings describing any repairs that were applied.
/// An empty list means the session was already valid.
pub fn validate_and_repair(session: &mut SessionData) -> Vec<String> {
    let mut warnings = Vec::new();

    for window in &mut session.windows {
        // 1. Remove duplicate tab IDs (keep first occurrence)
        let mut seen_ids = HashSet::new();
        let original_count = window.tabs.len();
        window.tabs.retain(|tab| seen_ids.insert(tab.id.clone()));

        let removed = original_count - window.tabs.len();
        if removed > 0 {
            warnings.push(format!(
                "Window '{}': removed {} duplicate tab(s)",
                window.window_label, removed
            ));
        }

        // 2. Fix active_tab_id referencing a nonexistent tab
        if let Some(active_id) = &window.active_tab_id {
            let exists = window.tabs.iter().any(|t| t.id == *active_id);
            if !exists {
                let old_id = active_id.clone();
                window.active_tab_id = window.tabs.first().map(|t| t.id.clone());
                warnings.push(format!(
                    "Window '{}': active_tab_id '{}' not found in tabs, reset to {:?}",
                    window.window_label,
                    old_id,
                    window.active_tab_id
                ));
            }
        }

        // 3. Warn about empty windows (no tabs)
        if window.tabs.is_empty() {
            warnings.push(format!(
                "Window '{}': contains no tabs",
                window.window_label
            ));
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hot_exit::session::*;

    const TEST_VERSION: &str = "0.5.0";

    fn make_ui_state() -> UiState {
        UiState {
            sidebar_visible: true,
            sidebar_width: 260,
            outline_visible: false,
            sidebar_view_mode: "explorer".to_string(),
            status_bar_visible: true,
            source_mode_enabled: false,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
        }
    }

    fn make_tab(id: &str) -> TabState {
        TabState {
            id: id.to_string(),
            file_path: None,
            title: format!("Tab {}", id),
            is_pinned: false,
            document: DocumentState {
                content: String::new(),
                saved_content: String::new(),
                is_dirty: false,
                is_missing: false,
                is_divergent: false,
                line_ending: "\n".to_string(),
                cursor_info: None,
                last_modified_timestamp: None,
                is_untitled: true,
                untitled_number: Some(1),
                undo_history: Vec::new(),
                redo_history: Vec::new(),
            },
        }
    }

    fn make_window(label: &str, tab_ids: &[&str], active: Option<&str>) -> WindowState {
        WindowState {
            window_label: label.to_string(),
            is_main_window: label == "main",
            active_tab_id: active.map(|s| s.to_string()),
            tabs: tab_ids.iter().map(|id| make_tab(id)).collect(),
            ui_state: make_ui_state(),
            geometry: None,
        }
    }

    fn make_session(windows: Vec<WindowState>) -> SessionData {
        SessionData {
            version: SCHEMA_VERSION,
            timestamp: chrono::Utc::now().timestamp(),
            vmark_version: TEST_VERSION.to_string(),
            windows,
            workspace: None,
        }
    }

    #[test]
    fn valid_session_produces_no_warnings() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1", "tab-2"], Some("tab-1")),
        ]);

        let warnings = validate_and_repair(&mut session);
        assert!(warnings.is_empty());
    }

    #[test]
    fn active_tab_id_none_is_valid() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1"], None),
        ]);

        let warnings = validate_and_repair(&mut session);
        assert!(warnings.is_empty());
    }

    #[test]
    fn fixes_active_tab_id_referencing_nonexistent_tab() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1", "tab-2"], Some("tab-gone")),
        ]);

        let warnings = validate_and_repair(&mut session);

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("active_tab_id 'tab-gone' not found"));
        // Should reset to first tab
        assert_eq!(
            session.windows[0].active_tab_id,
            Some("tab-1".to_string())
        );
    }

    #[test]
    fn fixes_active_tab_id_to_none_when_no_tabs() {
        let mut session = make_session(vec![
            make_window("main", &[], Some("tab-gone")),
        ]);

        let warnings = validate_and_repair(&mut session);

        // Should produce warnings for both invalid active_tab_id and empty window
        assert!(warnings.iter().any(|w| w.contains("active_tab_id")));
        assert!(warnings.iter().any(|w| w.contains("contains no tabs")));
        assert_eq!(session.windows[0].active_tab_id, None);
    }

    #[test]
    fn removes_duplicate_tab_ids() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1", "tab-1", "tab-2", "tab-2", "tab-3"], Some("tab-1")),
        ]);

        let warnings = validate_and_repair(&mut session);

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("removed 2 duplicate tab(s)"));
        // Should keep only unique tabs (first occurrence)
        let ids: Vec<&str> = session.windows[0]
            .tabs
            .iter()
            .map(|t| t.id.as_str())
            .collect();
        assert_eq!(ids, vec!["tab-1", "tab-2", "tab-3"]);
    }

    #[test]
    fn removes_duplicates_then_fixes_active_tab() {
        // active_tab_id was a duplicate that got removed
        let mut session = make_session(vec![
            make_window("main", &["tab-1", "tab-2", "tab-2"], Some("tab-dup-gone")),
        ]);

        let warnings = validate_and_repair(&mut session);

        // Should have both a duplicate warning and an active_tab_id warning
        assert!(warnings.iter().any(|w| w.contains("duplicate")));
        assert!(warnings.iter().any(|w| w.contains("active_tab_id")));
        // active_tab_id should be reset to first remaining tab
        assert_eq!(
            session.windows[0].active_tab_id,
            Some("tab-1".to_string())
        );
    }

    #[test]
    fn warns_about_empty_window() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1"], Some("tab-1")),
            make_window("secondary", &[], None),
        ]);

        let warnings = validate_and_repair(&mut session);

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("Window 'secondary': contains no tabs"));
    }

    #[test]
    fn handles_multiple_windows_independently() {
        let mut session = make_session(vec![
            make_window("main", &["tab-1", "tab-1"], Some("tab-1")),
            make_window("secondary", &["tab-a", "tab-b"], Some("tab-missing")),
        ]);

        let warnings = validate_and_repair(&mut session);

        assert_eq!(warnings.len(), 2);
        // Window 1: duplicate
        assert!(warnings.iter().any(|w| w.contains("Window 'main'") && w.contains("duplicate")));
        // Window 2: invalid active_tab_id
        assert!(warnings.iter().any(|w| w.contains("Window 'secondary'") && w.contains("active_tab_id")));

        // Verify repairs
        assert_eq!(session.windows[0].tabs.len(), 1);
        assert_eq!(
            session.windows[1].active_tab_id,
            Some("tab-a".to_string())
        );
    }

    #[test]
    fn empty_session_is_valid() {
        let mut session = make_session(vec![]);

        let warnings = validate_and_repair(&mut session);
        assert!(warnings.is_empty());
    }
}
