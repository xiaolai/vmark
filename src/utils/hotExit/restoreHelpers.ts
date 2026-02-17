/**
 * Hot Exit Restore Helpers
 *
 * Helper functions extracted from useHotExitRestore.ts:
 *   - restoreWindowState: orchestrates per-window restore
 *   - restoreUiState: sidebar, view modes, terminal
 *   - restoreTabs: tab creation, ordering, active tab
 *   - restoreDocumentState: content, flags, cursor
 *   - restoreUnifiedHistory: undo/redo checkpoint stacks
 *   - pullWindowStateWithRetry: retry loop for Rust invoke
 *
 * @coordinates-with useHotExitRestore.ts — consumes these helpers
 * @module utils/hotExit/restoreHelpers
 */

import { invoke } from '@tauri-apps/api/core';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUnifiedHistoryStore } from '@/stores/unifiedHistoryStore';
import type { WindowState, HistoryCheckpoint, CursorInfo, TabState, DocumentState } from './types';
import type { LineEnding } from '@/utils/linebreakDetection';
import type { HistoryCheckpoint as StoreHistoryCheckpoint } from '@/stores/unifiedHistoryStore';
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
    console.warn('[HotExit] Invalid cursor info, skipping restore');
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
        return windowState;
      }

      // State not found - wait and retry (might not be stored yet)
      if (attempt < retries) {
        console.log(`[HotExit] Window '${windowLabel}' state not ready, retry ${attempt}/${retries}`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[HotExit] Failed to pull state for '${windowLabel}' (attempt ${attempt}):`, error);
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
export async function restoreWindowState(windowLabel: string, windowState: WindowState): Promise<void> {
  // Restore UI state first (before tabs)
  restoreUiState(windowState);

  // Restore tabs
  await restoreTabs(windowLabel, windowState);
}

/**
 * Restore UI state (sidebar, view modes, etc.)
 */
export function restoreUiState(windowState: WindowState): void {
  const { ui_state } = windowState;
  const uiStore = useUIStore.getState();
  const editorStore = useEditorStore.getState();

  // Validate sidebar_view_mode before setting
  const viewMode = (ui_state.sidebar_view_mode === 'files' || ui_state.sidebar_view_mode === 'outline')
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
  if (ui_state.source_mode_enabled !== editorStore.sourceMode) {
    editorStore.toggleSourceMode();
  }
  if (ui_state.focus_mode_enabled !== editorStore.focusModeEnabled) {
    editorStore.toggleFocusMode();
  }
  if (ui_state.typewriter_mode_enabled !== editorStore.typewriterModeEnabled) {
    editorStore.toggleTypewriterMode();
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
export async function restoreTabs(windowLabel: string, windowState: WindowState): Promise<void> {
  const tabStore = useTabStore.getState();
  const documentStore = useDocumentStore.getState();

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

  // Restore each tab
  for (const tabState of windowState.tabs) {
    // Create tab (createTab auto-activates, but we'll set active tab explicitly after)
    const newTabId = tabStore.createTab(windowLabel, tabState.file_path);

    // Store mapping
    tabIdMap.set(tabState.id, newTabId);

    // Update tab metadata (title is required string, always set it)
    tabStore.updateTabTitle(newTabId, tabState.title);
    if (tabState.is_pinned) {
      tabStore.togglePin(windowLabel, newTabId);
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

  // Initialize document with saved content first
  documentStore.initDocument(tabId, docState.saved_content, file_path);

  // Load saved content with metadata
  documentStore.loadContent(tabId, docState.saved_content, file_path, {
    lineEnding,
  });

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

  console.log(
    `[HotExit] Restored unified history for tab '${tabId}': ${undoStack.length} undo, ${redoStack.length} redo checkpoints`
  );
}
