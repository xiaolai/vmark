/**
 * Hot Exit Types
 *
 * TypeScript definitions mirroring Rust structs in src-tauri/src/hot_exit/session.rs
 * These types define the complete application session state for save/restore.
 */

export const SCHEMA_VERSION = 3;

/**
 * Line ending types
 */
export type LineEnding = '\n' | '\r\n' | 'unknown';

/**
 * Complete application session state
 */
export interface SessionData {
  version: number;
  timestamp: number; // Unix timestamp
  vmark_version: string;
  windows: WindowState[];
  workspace: WorkspaceState | null;
}

export interface WindowState {
  window_label: string;
  is_main_window: boolean;
  active_tab_id: string | null;
  tabs: TabState[];
  ui_state: UiState;
  geometry: WindowGeometry | null;
}

export interface TabState {
  id: string;
  file_path: string | null;
  title: string;
  is_pinned: boolean;
  document: DocumentState;
  /**
   * Format registry id for this tab — added in v3 (WI-1A.13).
   *
   * Persisted directly rather than derived at restore: derivation
   * requires re-running content schemaDetectors (pure-but-paid) and
   * is fragile if the user has edited content between hot-exit and
   * restore. Direct persistence is the smaller correctness surface.
   *
   * Pre-v3 sessions backfill to "markdown" — see migrateV2toV3.
   */
  format_id: string;
  /**
   * Whether the user has explicitly enabled editing on a viewer-mode
   * format (e.g. read-only `.json`). Added in v3 (WI-1A.13).
   * Pre-v3 sessions backfill to `true` (markdown is editable by default).
   */
  editing_enabled: boolean;
  /**
   * Active schema renderer id when the format supports multiple
   * (e.g. yaml-gha-workflow vs generic yaml tree). Added in v3 (WI-1A.13).
   * Null/undefined means "use format default schema dispatch".
   */
  active_schema_id: string | null;
}

export interface DocumentState {
  content: string;
  saved_content: string;
  is_dirty: boolean;
  is_missing: boolean;
  is_divergent: boolean;
  is_read_only?: boolean;
  line_ending: LineEnding;
  cursor_info: CursorInfo | null;
  last_modified_timestamp: number | null;
  is_untitled: boolean;
  untitled_number: number | null;
  /** Undo history checkpoints (cross-mode undo) - added in v2 */
  undo_history: HistoryCheckpoint[];
  /** Redo history checkpoints (cross-mode redo) - added in v2 */
  redo_history: HistoryCheckpoint[];
}

/**
 * History checkpoint for cross-mode undo/redo
 * Mirrors unifiedHistoryStore.HistoryCheckpoint
 */
export interface HistoryCheckpoint {
  markdown: string;
  mode: 'source' | 'wysiwyg';
  cursor_info: CursorInfo | null;
  timestamp: number;
}

export interface CursorInfo {
  source_line: number; // 1-indexed line number from remark parser
  word_at_cursor: string; // Word at or near cursor
  offset_in_word: number; // Character offset within the word
  node_type: string; // "paragraph", "heading", "code_block", etc.
  percent_in_line: number; // Cursor position as percentage (0-1)
  context_before: string; // Characters before cursor for disambiguation
  context_after: string; // Characters after cursor for disambiguation
  block_anchor?: unknown; // Block-specific anchor (table/code block)
}

export interface UiState {
  sidebar_visible: boolean;
  sidebar_width: number;
  outline_visible: boolean;
  sidebar_view_mode: string; // "files" | "outline" | "history"
  status_bar_visible: boolean;
  source_mode_enabled: boolean;
  focus_mode_enabled: boolean;
  typewriter_mode_enabled: boolean;
  terminal_visible?: boolean;
  terminal_height?: number;
}

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceState {
  root_path: string | null;
  is_workspace_mode: boolean;
  show_hidden_files: boolean;
}

/**
 * Event payloads
 */
export interface CaptureRequest {
  /** Unique ID to correlate responses with this request */
  capture_id: string;
}

export interface CaptureResponse {
  /** Must match the capture_id from the request */
  capture_id: string;
  window_label: string;
  state: WindowState;
}

/**
 * Event names (must match Rust constants)
 */
export const HOT_EXIT_EVENTS = {
  CAPTURE_REQUEST: 'hot-exit:capture-request',
  CAPTURE_RESPONSE: 'hot-exit:capture-response',
  CAPTURE_TIMEOUT: 'hot-exit:capture-timeout',
  RESTORE_START: 'hot-exit:restore-start',
  RESTORE_COMPLETE: 'hot-exit:restore-complete',
  RESTORE_FAILED: 'hot-exit:restore-failed',
  TRIGGER_RESTART: 'hot-exit:trigger-restart',
} as const;

/**
 * Main window label constant (must match Rust MAIN_WINDOW_LABEL)
 */
export const MAIN_WINDOW_LABEL = 'main';
