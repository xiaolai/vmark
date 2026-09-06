//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;
use crate::hot_exit::session::*;
use tempfile::TempDir;

/// Create a valid minimal SessionData for testing.
fn make_valid_session() -> SessionData {
    SessionData {
        version: SCHEMA_VERSION,
        timestamp: chrono::Utc::now().timestamp(),
        vmark_version: "0.6.9-test".to_string(),
        windows: vec![WindowState {
            window_label: "main".to_string(),
            is_main_window: true,
            active_tab_id: Some("tab-1".to_string()),
            tabs: vec![TabState {
                id: "tab-1".to_string(),
                file_path: Some("/tmp/test.md".to_string()),
                title: "Test".to_string(),
                is_pinned: false,
                document: DocumentState {
                    content: "# Hello".to_string(),
                    saved_content: "# Hello".to_string(),
                    is_dirty: false,
                    is_missing: false,
                    is_divergent: false,
                    line_ending: "\n".to_string(),
                    cursor_info: None,
                    last_modified_timestamp: None,
                    is_untitled: false,
                    untitled_number: None,
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
            }],
            ui_state: UiState {
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
        }],
        workspace: None,
    }
}
