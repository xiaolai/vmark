//! Session data structures for hot exit
//!
//! These structs mirror the TypeScript types in src/services/persistence/hotExit/types.ts

use serde::{Deserialize, Serialize};

// Provenance for a session read lives in its own module (size gate) but is
// re-exported here, which is where every consumer already imports from.
pub use super::loaded::LoadedSession;

/// Schema version for hot exit sessions
/// v1: Initial schema
/// v2: Added undo_history and redo_history to DocumentState
/// v3: Added format_id, editing_enabled, active_schema_id to TabState (WI-1A.13)
/// v4: Added workspace rail instance containers to WindowState
/// v5: Added explicit workspace instance kind and unavailable-root marker
pub const SCHEMA_VERSION: u32 = 5;

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
    /// Ordered workspace instance ids owned by this document window. Added in v4.
    #[serde(default)]
    pub workspace_instance_ids: Vec<String>,
    /// Active workspace instance id for this document window. Added in v4.
    #[serde(default)]
    pub active_workspace_instance_id: Option<String>,
    /// Workspace instances owned by this document window. Added in v4.
    #[serde(default)]
    pub workspace_instances: Vec<WorkspaceInstanceState>,
    /// WI-9.4 (workspace rail): per-instance UI state, opaque to Rust —
    /// captured and interpreted by the frontend only. Optional + defaulted so
    /// pre-rail payloads round-trip unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_state_by_instance: Option<serde_json::Value>,
    /// WI-9.4: scoped closed-tab history (reopen metadata), opaque to Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_tab_scopes: Option<serde_json::Value>,
    /// WI-9.4/8.2: window-global human browser records, opaque to Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_session: Option<serde_json::Value>,
}

/// Workspace rail instance metadata. Field casing mirrors the frontend model.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInstanceState {
    pub workspace_instance_id: String,
    #[serde(default)]
    pub kind: String,
    pub root_id: Option<String>,
    pub root_path: Option<String>,
    pub display_name: String,
    pub owner_window_label: String,
    pub created_from: String,
    pub active_tab_id: Option<String>,
    pub tab_ids: Vec<String>,
    pub closed_tab_ids: Vec<String>,
    #[serde(default)]
    pub unavailable_root: bool,
}

/// State of a single tab including its document content and metadata.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TabState {
    pub id: String,
    pub file_path: Option<String>,
    pub title: String,
    pub is_pinned: bool,
    pub document: DocumentState,
    /// Format registry id (e.g. "markdown", "json"). Added in v3 (WI-1A.13).
    /// Pre-v3 sessions backfill to "markdown" via the v2→v3 migration. Serde
    /// `default` keeps cross-version deserialization safe even if the
    /// migration is bypassed.
    #[serde(default = "default_format_id")]
    pub format_id: String,
    /// Whether the user has explicitly enabled editing on a viewer-mode
    /// format. Added in v3 (WI-1A.13). Pre-v3 backfills to `true`.
    #[serde(default = "default_editing_enabled")]
    pub editing_enabled: bool,
    /// Active schemaRenderer id when the format supports multiple. Added in v3.
    #[serde(default)]
    pub active_schema_id: Option<String>,
}

fn default_format_id() -> String {
    "markdown".to_string()
}

fn default_editing_enabled() -> bool {
    true
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
    /// Per-document editor mode (ADR-009): "wysiwyg" | "source".
    /// Optional; pre-existing sessions deserialize to None and are
    /// restored as "wysiwyg" by the frontend restore path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// Hard-break style detected from file content:
    /// "backslash" | "twoSpaces" | "mixed" | "unknown". Optional —
    /// pre-existing sessions deserialize to None and fall back to
    /// "unknown" (re-detect on next save).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hard_break_style: Option<String>,
    /// Normalized on-disk content (post-line-ending/break normalization).
    /// Optional. When absent, the restore path uses `saved_content` —
    /// usually identical but can diverge if the save step applied
    /// normalization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_disk_content: Option<String>,
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
            log::warn!(
                "[HotExit] Warning: max_age_days must be positive (got {})",
                max_age_days
            );
            return true; // Treat as stale to be safe
        }

        let now = chrono::Utc::now().timestamp();
        // CHECKED: `self.timestamp` is untrusted — it comes straight off disk,
        // and `i64::MIN` deserializes happily. `now - i64::MIN` overflows, which
        // panics in a debug build (audit 20260906, B7). The neighbouring
        // `checked_mul` below already guards the other arithmetic here for the
        // same reason.
        let Some(age_seconds) = now.checked_sub(self.timestamp) else {
            log::warn!(
                "[HotExit] Warning: Session timestamp {} is out of range",
                self.timestamp
            );
            return true; // Unusable timestamp — treat as stale, never restore.
        };

        // Treat future timestamps as stale (clock skew)
        if age_seconds < 0 {
            log::warn!("[HotExit] Warning: Session timestamp is in the future (clock skew)");
            return true;
        }

        // Use checked_mul to prevent overflow
        match max_age_days.checked_mul(SECONDS_PER_DAY) {
            Some(max_age_seconds) => age_seconds > max_age_seconds,
            None => {
                log::warn!(
                    "[HotExit] Warning: max_age_days overflow ({})",
                    max_age_days
                );
                true // Treat as stale on overflow
            }
        }
    }
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
