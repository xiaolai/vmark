import { invoke } from '@tauri-apps/api/core';
import { hotExitLog, hotExitWarn } from '@/utils/debug';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore, TERMINAL_MAX_RATIO } from '@/stores/uiStore';
import { useUnifiedHistoryStore } from '@/stores/documentStore';
import {
  clearExistingWindowTabs,
  deduplicateTabsByPath,
  filterMeaningfulTabs,
  restoreActiveTab,
  restoreTabMetadata,
} from './restoreTabsHelpers';
import type { WindowState, HistoryCheckpoint, CursorInfo, TabState, DocumentState } from './types';
import type { LineEnding } from '@/utils/linebreakDetection';
import type { HistoryCheckpoint as StoreHistoryCheckpoint } from '@/stores/documentStore';
import type { CursorInfo as StoreCursorInfo } from '@/types/cursorSync';

/**
 * Maximum retries when pulling state (handles timing issues). Exported so the
 * restore coordinator reports the same retry count it actually applies —
 * keeping the log message and behavior from drifting apart.
 */
export const MAX_STATE_RETRIES = 5;
/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 100;
/** Minimum valid sidebar width */
const MIN_SIDEBAR_WIDTH = 150;
/** Maximum valid sidebar width */
const MAX_SIDEBAR_WIDTH = 500;
/** Default sidebar width if invalid */
const DEFAULT_SIDEBAR_WIDTH = 260;

/** Simple sleep helper */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Shape guard for the `hot_exit_get_window_state` IPC payload (T1/ADR-2). The
 * restore path indexes `windowState.ui_state.*`, calls `windowState.tabs.filter`,
 * and immediately dereferences each tab via `isEmptyUntitledTab` (`tab.file_path`,
 * `tab.document.content`) — so a malformed container OR a malformed tab entry
 * (`tabs: [null]`, a tab missing `document`) would throw mid-restore and abort
 * recovery. This validates the container plus the early-deref shape of each tab
 * (entry is an object with an object `document`). Deeper per-field narrowing
 * (line endings, cursor, schema id) already happens downstream in
 * restoreDocumentState/restoreUiState. Exported for testing.
 */
export function isValidWindowState(raw: unknown): raw is WindowState {
  if (typeof raw !== 'object' || raw === null) return false;
  const w = raw as Record<string, unknown>;
  const uiOk =
    typeof w.ui_state === 'object' && w.ui_state !== null && !Array.isArray(w.ui_state);
  const tabsOk =
    Array.isArray(w.tabs) &&
    w.tabs.every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { document?: unknown }).document === 'object' &&
        (t as { document?: unknown }).document !== null
    );
  return (
    typeof w.window_label === 'string' &&
    tabsOk &&
    uiOk &&
    (w.active_tab_id === null || typeof w.active_tab_id === 'string')
  );
}

/**
 * Convert hot exit line ending format back to store format
 */
function fromHotExitLineEnding(lineEnding: '\n' | '\r\n' | 'unknown'): LineEnding {
  switch (lineEnding) {
    case '\n':
      return 'lf';
    case '\r\n':
      return 'crlf';
    case 'unknown':
      return 'unknown';
  }
}

/**
 * Convert hot exit cursor info to store format with validation.
 * Returns null if input is null/undefined or has invalid data.
 */
function toStoreCursorInfo(cursorInfo: CursorInfo | null | undefined): StoreCursorInfo | null {
  if (!cursorInfo) return null;

  // Validate required numeric fields against their domains, not just
  // finiteness. source_line is 1-indexed (remark), so it must be a positive
  // integer; offset_in_word is a character offset (non-negative); and
  // percent_in_line is a fraction in [0, 1]. Corrupt persisted state outside
  // these ranges would otherwise be restored into editor cursor sync.
  if (
    !Number.isInteger(cursorInfo.source_line) ||
    cursorInfo.source_line < 1 ||
    !Number.isFinite(cursorInfo.offset_in_word) ||
    cursorInfo.offset_in_word < 0 ||
    !Number.isFinite(cursorInfo.percent_in_line) ||
    cursorInfo.percent_in_line < 0 ||
    cursorInfo.percent_in_line > 1
  ) {
    hotExitWarn('Invalid cursor info, skipping restore');
    return null;
  }

  return {
    sourceLine: cursorInfo.source_line,
    wordAtCursor: cursorInfo.word_at_cursor ?? '',
    offsetInWord: cursorInfo.offset_in_word,
    nodeType: (cursorInfo.node_type ?? 'paragraph') as StoreCursorInfo['nodeType'],
    percentInLine: cursorInfo.percent_in_line,
    contextBefore: cursorInfo.context_before ?? '',
    contextAfter: cursorInfo.context_after ?? '',
    blockAnchor: cursorInfo.block_anchor as StoreCursorInfo['blockAnchor'],
  };
}

/**
 * Convert hot exit checkpoint back to store format
 */
function fromHotExitCheckpoint(checkpoint: HistoryCheckpoint): StoreHistoryCheckpoint {
  return {
    markdown: checkpoint.markdown,
    mode: checkpoint.mode === 'source' || checkpoint.mode === 'wysiwyg'
      ? checkpoint.mode
      : 'wysiwyg', // Default to wysiwyg if invalid
    cursorInfo: toStoreCursorInfo(checkpoint.cursor_info),
    timestamp: checkpoint.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Pull window state from Rust coordinator with retry logic.
 */
export async function pullWindowStateWithRetry(windowLabel: string, retries = MAX_STATE_RETRIES): Promise<WindowState | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const windowState = await invoke<WindowState | null>(
        'hot_exit_get_window_state',
        { windowLabel }
      );

      if (windowState) {
        // Reject a structurally malformed payload loudly (T1/ADR-2). Unlike a
        // null "not stored yet" result, a bad shape won't fix itself across
        // retries — return null immediately so the caller falls back to the
        // WindowContext init state instead of throwing mid-restore.
        if (!isValidWindowState(windowState)) {
          hotExitWarn(`Discarding malformed window state for '${windowLabel}'`);
          return null;
        }
        return windowState;
      }

      // State not found - wait and retry (might not be stored yet)
      if (attempt < retries) {
        hotExitLog(`Window '${windowLabel}' state not ready, retry ${attempt}/${retries}`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (error) {
      hotExitWarn(`Failed to pull state for '${windowLabel}' (attempt ${attempt}):`, error);
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  return null;
}

/**
 * Restore a window from its state (used by both event-driven and pull-based restore)
 */
export async function restoreWindowState(
  windowLabel: string,
  windowState: WindowState,
): Promise<Map<string, string>> {
  // Restore UI state first (before tabs)
  restoreUiState(windowState);

  // Restore tabs
  return restoreTabs(windowLabel, windowState);
}

/**
 * Restore UI state (sidebar, view modes, etc.)
 */
export function restoreUiState(windowState: WindowState): void {
  const { ui_state } = windowState;
  // Post-ADR-009: sidebar UI flags AND editor-view flags (sourceMode,
  // focusMode, typewriterMode) live on a single uiStore. The earlier
  // duplicate `editorStore = useUIStore.getState()` alias is gone.
  const uiStore = useUIStore.getState();

  // Validate sidebar_view_mode before setting
  const viewMode = (ui_state.sidebar_view_mode === 'files' || ui_state.sidebar_view_mode === 'outline' || ui_state.sidebar_view_mode === 'history')
    ? ui_state.sidebar_view_mode
    : 'files';

  // Validate sidebar_width: must be finite and within reasonable bounds
  const sidebarWidth = Number.isFinite(ui_state.sidebar_width)
    && ui_state.sidebar_width >= MIN_SIDEBAR_WIDTH
    && ui_state.sidebar_width <= MAX_SIDEBAR_WIDTH
      ? ui_state.sidebar_width
      : DEFAULT_SIDEBAR_WIDTH;

  // Restore sidebar state
  if (ui_state.sidebar_visible !== uiStore.sidebarVisible) {
    uiStore.toggleSidebar();
  }
  uiStore.setSidebarWidth(sidebarWidth);

  uiStore.setSidebarViewMode(viewMode);
  uiStore.setStatusBarVisible(ui_state.status_bar_visible);

  // Restore view modes
  if (ui_state.source_mode_enabled !== uiStore.sourceMode) {
    uiStore.toggleSourceMode();
  }
  if (ui_state.focus_mode_enabled !== uiStore.focusModeEnabled) {
    uiStore.toggleFocusMode();
  }
  if (ui_state.typewriter_mode_enabled !== uiStore.typewriterModeEnabled) {
    uiStore.toggleTypewriterMode();
  }

  // Restore terminal visibility and height (if saved)
  if (ui_state.terminal_visible != null && ui_state.terminal_visible !== uiStore.terminalVisible) {
    uiStore.toggleTerminal();
  }
  if (ui_state.terminal_height != null && Number.isFinite(ui_state.terminal_height)) {
    // setTerminalHeight only enforces the pixel floor; the proportional cap
    // (TERMINAL_MAX_RATIO of the viewport) is applied by viewport-aware layout
    // callers at runtime. On restore there is no resize event, so a corrupt
    // persisted value (e.g. larger than the screen) would otherwise produce an
    // unusably huge panel until the user manually resizes. Apply the same 50%
    // max policy here so restore lands inside the layout bounds.
    const maxHeight = window.innerHeight * TERMINAL_MAX_RATIO;
    uiStore.setTerminalHeight(Math.min(ui_state.terminal_height, maxHeight));
  }
}

/**
 * Restore tabs from window state
 */
export async function restoreTabs(
  windowLabel: string,
  windowState: WindowState,
): Promise<Map<string, string>> {
  const documentStore = useDocumentStore.getState();

  // Strip empty-untitled tabs first — restoring blank tabs adds orphan
  // clutter and there's nothing to recover. If filtering leaves nothing
  // meaningful, skip the entire clear-and-rebuild so the window keeps
  // whatever WindowContext init produced (a fresh blank tab in
  // non-workspace mode, or no tabs in workspace mode).
  const meaningfulTabs = filterMeaningfulTabs(windowState.tabs);
  if (meaningfulTabs.length === 0) {
    hotExitLog(`No meaningful tabs to restore for '${windowLabel}'; preserving WindowContext fallback`);
    return new Map();
  }

  clearExistingWindowTabs(windowLabel);

  const { kept, duplicateToRetained } = deduplicateTabsByPath(meaningfulTabs);

  // Build tab ID mapping: session tab ID -> new tab ID
  const tabIdMap = new Map<string, string>();
  const tabStore = useTabStore.getState();

  for (const tabState of kept) {
    // createTab auto-activates; we set the active tab explicitly afterward.
    const newTabId = tabStore.createTab(windowLabel, tabState.file_path);
    tabIdMap.set(tabState.id, newTabId);
    restoreTabMetadata(windowLabel, newTabId, tabState);
    await restoreDocumentState(newTabId, tabState, documentStore);
  }

  restoreActiveTab(windowLabel, windowState, tabIdMap, duplicateToRetained);

  return tabIdMap;
}

/**
 * Restore document state for a tab
 */
export async function restoreDocumentState(
  tabId: string,
  tabState: TabState,
  documentStore: ReturnType<typeof useDocumentStore.getState>
): Promise<void> {
  const { document: docState, file_path } = tabState;

  // Convert line ending format (validate and narrow type)
  const lineEnding = (
    docState.line_ending === '\n' ||
    docState.line_ending === '\r\n' ||
    docState.line_ending === 'unknown'
  )
    ? fromHotExitLineEnding(docState.line_ending)
    : ('unknown' as LineEnding);

  // Validate persisted hardBreakStyle against the documentStore's union.
  // Pre-existing sessions write this as undefined and fall back to detection.
  const hardBreakStyle =
    docState.hard_break_style === 'backslash' ||
    docState.hard_break_style === 'twoSpaces' ||
    docState.hard_break_style === 'mixed' ||
    docState.hard_break_style === 'unknown'
      ? docState.hard_break_style
      : undefined;

  // Initialize document with saved content first
  documentStore.initDocument(tabId, docState.saved_content, file_path);

  // Load saved content with metadata
  documentStore.loadContent(tabId, docState.saved_content, file_path, {
    lineEnding,
    ...(hardBreakStyle ? { hardBreakStyle } : {}),
  });

  // Restore the actual on-disk snapshot when present. Falling back to
  // `saved_content` (loadContent's default) is workable but can fool the
  // external-change detector when the saver normalized line endings or
  // hard-break style differently from the in-memory saved content.
  if (typeof docState.last_disk_content === 'string') {
    documentStore.updateLastDiskContent(tabId, docState.last_disk_content);
  }

  // If dirty, apply current content (different from saved)
  if (docState.is_dirty) {
    documentStore.setContent(tabId, docState.content);
  }

  // Restore flags
  if (docState.is_missing) {
    documentStore.markMissing(tabId);
  }
  if (docState.is_divergent) {
    documentStore.markDivergent(tabId);
  }
  if (docState.is_read_only) {
    documentStore.setReadOnly(tabId, true);
  }

  // Restore per-doc mode (ADR-009). Pre-mode-persistence sessions leave
  // this undefined; the documentStore default ("wysiwyg") then applies.
  if (docState.mode === 'wysiwyg' || docState.mode === 'source') {
    documentStore.setMode(tabId, docState.mode);
  }

  // Restore cursor info (using shared validation helper)
  const cursorInfo = toStoreCursorInfo(docState.cursor_info);
  if (cursorInfo) {
    documentStore.setCursorInfo(tabId, cursorInfo);
  }

  // Restore unified history (cross-mode undo/redo checkpoints)
  restoreUnifiedHistory(tabId, docState);
}

/**
 * Restore unified history checkpoints for a tab
 */
export function restoreUnifiedHistory(
  tabId: string,
  docState: DocumentState
): void {
  const undoHistory = docState.undo_history || [];
  const redoHistory = docState.redo_history || [];

  // Skip if no history to restore
  if (undoHistory.length === 0 && redoHistory.length === 0) {
    return;
  }

  // Convert checkpoints from hot exit format to store format
  const undoStack = undoHistory.map(fromHotExitCheckpoint);
  const redoStack = redoHistory.map(fromHotExitCheckpoint);

  // Directly set the history state for this document
  useUnifiedHistoryStore.setState((state) => ({
    documents: {
      ...state.documents,
      [tabId]: {
        undoStack,
        redoStack,
      },
    },
  }));

  hotExitLog(
    `Restored unified history for tab '${tabId}': ${undoStack.length} undo, ${redoStack.length} redo checkpoints`
  );
}
