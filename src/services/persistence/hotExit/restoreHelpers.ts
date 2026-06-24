import { invoke } from '@tauri-apps/api/core';
import { hotExitLog, hotExitWarn } from '@/utils/debug';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useUnifiedHistoryStore } from '@/stores/documentStore';
import { getFormatById } from '@/lib/formats/registry';
import type { WindowState, HistoryCheckpoint, CursorInfo, TabState, DocumentState } from './types';
import type { LineEnding } from '@/utils/linebreakDetection';
import type { HistoryCheckpoint as StoreHistoryCheckpoint } from '@/stores/documentStore';
import type { CursorInfo as StoreCursorInfo } from '@/types/cursorSync';

/** Maximum retries when pulling state (handles timing issues) */
const MAX_STATE_RETRIES = 5;
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

  // Validate required numeric fields
  if (
    !Number.isFinite(cursorInfo.source_line) ||
    !Number.isFinite(cursorInfo.offset_in_word) ||
    !Number.isFinite(cursorInfo.percent_in_line)
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
 * An empty-untitled tab carries no information: no file path, no saved
 * content, and no unsaved content. Restoring such tabs only adds orphan
 * blank tabs the user has to close manually — there is nothing to recover.
 */
function isEmptyUntitledTab(tab: TabState): boolean {
  return tab.file_path === null
    && tab.document.content === ""
    && tab.document.saved_content === "";
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
    uiStore.setTerminalHeight(ui_state.terminal_height);
  }
}

/**
 * Restore tabs from window state
 */
export async function restoreTabs(
  windowLabel: string,
  windowState: WindowState,
): Promise<Map<string, string>> {
  const tabStore = useTabStore.getState();
  const documentStore = useDocumentStore.getState();

  // Strip empty-untitled tabs first — restoring blank tabs adds orphan
  // clutter and there's nothing to recover. If filtering leaves nothing
  // meaningful, skip the entire clear-and-rebuild so the window keeps
  // whatever WindowContext init produced (a fresh blank tab in
  // non-workspace mode, or no tabs in workspace mode).
  const meaningfulTabs = windowState.tabs.filter((t) => !isEmptyUntitledTab(t));
  if (meaningfulTabs.length === 0) {
    hotExitLog(`No meaningful tabs to restore for '${windowLabel}'; preserving WindowContext fallback`);
    return new Map();
  }

  // Clear existing tabs by removing the window (bypasses pin rules)
  const existingTabs = tabStore.getTabsByWindow(windowLabel);
  const historyStore = useUnifiedHistoryStore.getState();
  existingTabs.forEach((tab) => {
    documentStore.removeDocument(tab.id);
    // Also clear unified history to prevent memory leaks
    historyStore.clearDocument(tab.id);
  });

  // Remove window from tab store to clear all tabs at once
  if (existingTabs.length > 0) {
    tabStore.removeWindow(windowLabel);
  }

  // Build tab ID mapping: session tab ID -> new tab ID
  const tabIdMap = new Map<string, string>();

  // Deduplicate tabs by file_path before restoring.
  // tabStore.createTab deduplicates by file_path, so a second createTab with
  // the same path returns the first tab's ID — causing restoreDocumentState
  // to overwrite the first tab's content. We skip later duplicates here to
  // prevent silent data loss.
  //
  // Compare paths exactly (no case folding). Earlier code lowercased paths
  // on non-Linux to handle case-insensitive HFS+/APFS/NTFS. That approach
  // incorrectly merged distinct files on case-sensitive APFS volumes — a
  // data-availability bug. Exact comparison may produce a duplicate tab on
  // case-insensitive filesystems (same file opened twice under different
  // casing), but that is strictly less severe.
  const seenFilePaths = new Set<string>();
  const deduplicatedTabs = meaningfulTabs.filter((tabState) => {
    if (!tabState.file_path) return true; // untitled tabs are never duplicates
    if (seenFilePaths.has(tabState.file_path)) {
      hotExitWarn(
        `Skipping duplicate tab '${tabState.id}' with file_path '${tabState.file_path}' during restore`
      );
      return false;
    }
    seenFilePaths.add(tabState.file_path);
    return true;
  });

  // Restore each tab
  for (const tabState of deduplicatedTabs) {
    // Create tab (createTab auto-activates, but we'll set active tab explicitly after)
    const newTabId = tabStore.createTab(windowLabel, tabState.file_path);

    // Store mapping
    tabIdMap.set(tabState.id, newTabId);

    // Update tab metadata (title is required string, always set it)
    tabStore.updateTabTitle(newTabId, tabState.title);
    if (tabState.is_pinned) {
      tabStore.togglePin(windowLabel, newTabId);
    }

    // WI-1A.13 — restore multi-format fields.
    //
    // For tabs WITH a file_path, `formatId` derives deterministically from
    // the extension via dispatchEditor — restoration is automatic.
    //
    // For UNTITLED tabs (file_path === null), derivation always falls back
    // to markdown. If the persisted format_id is not "markdown", explicitly
    // restore it. This guards untitled non-markdown sessions (e.g. an
    // unsaved JSON scratch tab) against silent format loss across restart.
    //
    // Validate against the format registry — a tampered or stale session
    // file could carry a format_id that no longer (or never) exists. Falling
    // through with an unknown id would inject inconsistent state into the
    // tab store.
    if (
      tabState.file_path == null &&
      tabState.format_id &&
      tabState.format_id !== "markdown"
    ) {
      if (getFormatById(tabState.format_id)) {
        tabStore.setTabFormatId(newTabId, tabState.format_id);
      } else {
        hotExitWarn(
          `Skipping unknown format_id '${tabState.format_id}' for restored tab '${tabState.id}'`
        );
      }
    }
    if (tabState.editing_enabled === false) {
      tabStore.setTabEditingEnabled(newTabId, false);
    }
    // Best-effort validation of the persisted schema id. We look up the
    // effective format (the validated format_id, or markdown for untitled
    // markdown tabs) and confirm the schema id matches one of its
    // registered renderers. If the registry can't resolve the format
    // (e.g. test environment without bootstrap, or the format was
    // unregistered after this session was saved), we cannot validate —
    // fall through and trust the persisted value rather than silently
    // drop it.
    if (tabState.active_schema_id != null) {
      const effectiveFormatId = tabState.format_id || "markdown";
      const format = getFormatById(effectiveFormatId);
      const renderers = format?.schemaRenderers;
      if (renderers && !(tabState.active_schema_id in renderers)) {
        hotExitWarn(
          `Skipping unknown active_schema_id '${tabState.active_schema_id}' for restored tab '${tabState.id}' (format '${effectiveFormatId}')`
        );
      } else {
        tabStore.setTabActiveSchemaId(newTabId, tabState.active_schema_id);
      }
    }

    // Restore document state
    await restoreDocumentState(newTabId, tabState, documentStore);
  }

  // Restore active tab using mapped ID
  if (windowState.active_tab_id) {
    const mappedActiveId = tabIdMap.get(windowState.active_tab_id);
    if (mappedActiveId) {
      tabStore.setActiveTab(windowLabel, mappedActiveId);
    } else {
      // Fallback to first tab if mapping not found
      const tabs = tabStore.getTabsByWindow(windowLabel);
      if (tabs.length > 0) {
        tabStore.setActiveTab(windowLabel, tabs[0].id);
      }
    }
  }

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
