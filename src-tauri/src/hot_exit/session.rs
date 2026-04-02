//! Session data structures for hot exit
//!
//! These structs mirror the TypeScript types in src/utils/hotExit/types.ts

use serde::{Deserialize, Serialize};

/// Schema version for hot exit sessions
/// v1: Initial schema
/// v2: Added undo_history and redo_history to DocumentState
pub const SCHEMA_VERSION: u32 = 2;

/// Maximum session age in days before considering it stale
pub const MAX_SESSION_AGE_DAYS: i64 = 7;

/// Seconds per day constant to avoid magic numbers
const SECONDS_PER_DAY: i64 = 86_400;

/// Complete application session state
/// Complete application session state for hot exit persistence.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionData {
    pub version: u32,
    pub timestamp: i64,
    pub vmark_version: String,
    pub windows: Vec<WindowState>,
    pub workspace: Option<WorkspaceState>,
}

/// State of a single window including tabs, UI layout, and geometry.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WindowState {
    pub window_label: String,
    pub is_main_window: bool,
    pub active_tab_id: Option<String>,
    pub tabs: Vec<TabState>,
    pub ui_state: UiState,
    pub geometry: Option<WindowGeometry>,
}

/// State of a single tab including its document content and metadata.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TabState {
    pub id: String,
    pub file_path: Option<String>,
    pub title: String,
    pub is_pinned: bool,
    pub document: DocumentState,
}

/// Document content, dirty state, cursor position, and undo history.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DocumentState {
    pub content: String,
    pub saved_content: String,
    pub is_dirty: bool,
    pub is_missing: bool,
    pub is_divergent: bool,
    pub line_ending: String,
    pub cursor_info: Option<CursorInfo>,
    pub last_modified_timestamp: Option<i64>,
    pub is_untitled: bool,
    pub untitled_number: Option<u32>,
    /// Whether the document is read-only (added in v2 via serde default)
    #[serde(default)]
    pub is_read_only: bool,
    /// Undo history checkpoints (cross-mode undo) - added in v2
    #[serde(default)]
    pub undo_history: Vec<HistoryCheckpoint>,
    /// Redo history checkpoints (cross-mode redo) - added in v2
    #[serde(default)]
    pub redo_history: Vec<HistoryCheckpoint>,
}

/// History checkpoint for cross-mode undo/redo
/// Mirrors frontend unifiedHistoryStore.HistoryCheckpoint
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HistoryCheckpoint {
    pub markdown: String,
    pub mode: String, // "source" | "wysiwyg"
    pub cursor_info: Option<CursorInfo>,
    pub timestamp: i64,
}

/// Cursor position context for cross-mode cursor restoration.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CursorInfo {
    pub source_line: u32,
    pub word_at_cursor: String,
    pub offset_in_word: u32,
    pub node_type: String,
    pub percent_in_line: f32,
    pub context_before: String,
    pub context_after: String,
    pub block_anchor: Option<serde_json::Value>, // Polymorphic - can be TableAnchor or CodeBlockAnchor
}

/// UI layout state: sidebar, outline, mode toggles, and terminal visibility.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UiState {
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub outline_visible: bool,
    pub sidebar_view_mode: String,
    pub status_bar_visible: bool,
    pub source_mode_enabled: bool,
    pub focus_mode_enabled: bool,
    pub typewriter_mode_enabled: bool,
    #[serde(default)]
    pub terminal_visible: bool,
    #[serde(default = "default_terminal_height")]
    pub terminal_height: u32,
}

fn default_terminal_height() -> u32 {
    250
}

/// Window position and size in screen coordinates.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Workspace root path and display preferences.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkspaceState {
    pub root_path: Option<String>,
    pub is_workspace_mode: bool,
    pub show_hidden_files: bool,
}

impl SessionData {
    /// Create empty session with current version (test helper)
    #[cfg(test)]
    pub fn new(vmark_version: String) -> Self {
        Self {
            version: SCHEMA_VERSION,
            timestamp: chrono::Utc::now().timestamp(),
            vmark_version,
            windows: Vec::new(),
            workspace: None,
        }
    }

    /// Check if session is stale (older than max_age_days)
    ///
    /// Returns true if:
    /// - Session is older than max_age_days
    /// - Session timestamp is in the future (clock skew)
    /// - max_age_days is invalid (<= 0)
    pub fn is_stale(&self, max_age_days: i64) -> bool {
        // Guard against invalid input
        if max_age_days <= 0 {
            log::warn!("[HotExit] Warning: max_age_days must be positive (got {})", max_age_days);
            return true; // Treat as stale to be safe
        }

        let now = chrono::Utc::now().timestamp();
        let age_seconds = now - self.timestamp;

        // Treat future timestamps as stale (clock skew)
        if age_seconds < 0 {
            log::warn!("[HotExit] Warning: Session timestamp is in the future (clock skew)");
            return true;
        }

        // Use checked_mul to prevent overflow
        match max_age_days.checked_mul(SECONDS_PER_DAY) {
            Some(max_age_seconds) => age_seconds > max_age_seconds,
            None => {
                log::warn!("[HotExit] Warning: max_age_days overflow ({})", max_age_days);
                true // Treat as stale on overflow
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_VERSION: &str = "0.3.18";

    #[test]
    fn test_session_serialization() {
        let session = SessionData::new(TEST_VERSION.to_string());
        let json = serde_json::to_string(&session).unwrap();
        let deserialized: SessionData = serde_json::from_str(&json).unwrap();
        assert_eq!(session.version, deserialized.version);
        assert_eq!(session.vmark_version, deserialized.vmark_version);
    }

    #[test]
    fn test_session_compatibility() {
        let session = SessionData::new(TEST_VERSION.to_string());
        assert_eq!(session.version, SCHEMA_VERSION);

        let mut old_session = SessionData::new(TEST_VERSION.to_string());
        old_session.version = 0;
        assert_ne!(old_session.version, SCHEMA_VERSION);
    }

    #[test]
    fn test_stale_session() {
        let mut session = SessionData::new(TEST_VERSION.to_string());
        let now = chrono::Utc::now().timestamp();

        // 8 days old - should be stale
        session.timestamp = now - (8 * SECONDS_PER_DAY);
        assert!(session.is_stale(MAX_SESSION_AGE_DAYS));

        // 6 days old - should not be stale
        session.timestamp = now - (6 * SECONDS_PER_DAY);
        assert!(!session.is_stale(MAX_SESSION_AGE_DAYS));

        // Future timestamp - should be stale (clock skew)
        session.timestamp = now + SECONDS_PER_DAY;
        assert!(session.is_stale(MAX_SESSION_AGE_DAYS));

        // Invalid max_age_days - should be stale
        session.timestamp = now - SECONDS_PER_DAY;
        assert!(session.is_stale(0));
        assert!(session.is_stale(-1));
    }
}
