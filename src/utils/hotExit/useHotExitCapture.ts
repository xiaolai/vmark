/**
 * Hot Exit Capture Hook
 *
 * Listens for capture requests from Rust coordinator and responds with
 * current window state (tabs, documents, UI state).
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUnifiedHistoryStore } from '@/stores/unifiedHistoryStore';
import type { WindowState, TabState, CaptureRequest, CaptureResponse, CursorInfo } from './types';
import { HOT_EXIT_EVENTS, MAIN_WINDOW_LABEL } from './types';
import type { LineEnding as StoreLineEnding } from '@/utils/linebreakDetection';
import type { HistoryCheckpoint as StoreHistoryCheckpoint } from '@/stores/unifiedHistoryStore';
import type { CursorInfo as StoreCursorInfo } from '@/stores/documentStore';

/**
 * Convert store line ending format to hot exit format
 */
function toHotExitLineEnding(lineEnding: StoreLineEnding): '\n' | '\r\n' | 'unknown' {
  switch (lineEnding) {
    case 'lf':
      return '\n';
    case 'crlf':
      return '\r\n';
    case 'unknown':
      return 'unknown';
    default:
      // Exhaustiveness guard for future enum additions
      return 'unknown';
  }
}

/**
 * Convert store cursor info to hot exit format
 */
function toHotExitCursorInfo(cursorInfo: StoreCursorInfo | null | undefined): CursorInfo | null {
  if (!cursorInfo) return null;
  return {
    source_line: cursorInfo.sourceLine,
    word_at_cursor: cursorInfo.wordAtCursor,
    offset_in_word: cursorInfo.offsetInWord,
    node_type: cursorInfo.nodeType,
    percent_in_line: cursorInfo.percentInLine,
    context_before: cursorInfo.contextBefore,
    context_after: cursorInfo.contextAfter,
    block_anchor: cursorInfo.blockAnchor,
  };
}

/**
 * Convert store history checkpoint to hot exit format
 */
function toHotExitCheckpoint(checkpoint: StoreHistoryCheckpoint) {
  return {
    markdown: checkpoint.markdown,
    mode: checkpoint.mode,
    cursor_info: toHotExitCursorInfo(checkpoint.cursorInfo),
    timestamp: checkpoint.timestamp,
  };
}

/**
 * Gather UI state from stores (safe - catches errors)
 */
function getUiStateSafe() {
  try {
    const uiStore = useUIStore.getState();
    const editorStore = useEditorStore.getState();

    return {
      sidebar_visible: uiStore.sidebarVisible,
      sidebar_width: uiStore.sidebarWidth,
      outline_visible: false, // deprecated — kept for backward compat with saved data
      sidebar_view_mode: uiStore.sidebarViewMode,
      status_bar_visible: uiStore.statusBarVisible,
      source_mode_enabled: editorStore.sourceMode,
      focus_mode_enabled: editorStore.focusModeEnabled,
      typewriter_mode_enabled: editorStore.typewriterModeEnabled,
      terminal_visible: uiStore.terminalVisible,
      terminal_height: uiStore.terminalHeight,
    };
  } catch {
    // Return defaults if store access fails
    return {
      sidebar_visible: true,
      sidebar_width: 260,
      outline_visible: false,
      sidebar_view_mode: 'files',
      status_bar_visible: true,
      source_mode_enabled: false,
      focus_mode_enabled: false,
      typewriter_mode_enabled: false,
      terminal_visible: false,
      terminal_height: 250,
    };
  }
}

/**
 * Build capture response (shared between success and fallback paths)
 */
function buildCaptureResponse(captureId: string, windowLabel: string, state: WindowState): CaptureResponse {
  return {
    capture_id: captureId,
    window_label: windowLabel,
    state,
  };
}

/**
 * Extract untitled number from tab title like "Untitled-5"
 */
function extractUntitledNumber(title: string): number | null {
  const match = title.match(/^Untitled-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Capture document state for a tab
 */
function captureDocumentState(
  tabId: string,
  filePath: string | null,
  title: string,
  documentStore: ReturnType<typeof useDocumentStore.getState>,
  historyStore: ReturnType<typeof useUnifiedHistoryStore.getState>
) {
  const doc = documentStore.getDocument(tabId);
  const docHistory = historyStore.documents[tabId];

  // Capture undo/redo history (always try to preserve)
  const undoHistory = docHistory?.undoStack.map(toHotExitCheckpoint) || [];
  const redoHistory = docHistory?.redoStack.map(toHotExitCheckpoint) || [];

  // Compute untitled state once
  const isUntitled = !filePath;
  const untitledNumber = isUntitled ? extractUntitledNumber(title) : null;

  if (doc) {
    return {
      content: doc.content,
      saved_content: doc.savedContent,
      is_dirty: doc.isDirty,
      is_missing: doc.isMissing,
      is_divergent: doc.isDivergent,
      line_ending: toHotExitLineEnding(doc.lineEnding),
      cursor_info: toHotExitCursorInfo(doc.cursorInfo),
      last_modified_timestamp: doc.lastAutoSave,
      is_untitled: isUntitled,
      untitled_number: untitledNumber,
      undo_history: undoHistory,
      redo_history: redoHistory,
    };
  }

  // Fallback if document not found - still preserve history if available
  return {
    content: '',
    saved_content: '',
    is_dirty: false,
    is_missing: false,
    is_divergent: false,
    line_ending: '\n' as const,
    cursor_info: null,
    last_modified_timestamp: null,
    is_untitled: isUntitled,
    untitled_number: untitledNumber,
    undo_history: undoHistory,
    redo_history: redoHistory,
  };
}

/**
 * Capture complete window state
 */
function captureWindowState(windowLabel: string, isMainWindow: boolean): WindowState {
  const tabStore = useTabStore.getState();
  const documentStore = useDocumentStore.getState();
  const historyStore = useUnifiedHistoryStore.getState();

  // Get tabs for this window
  const windowTabs = tabStore.getTabsByWindow(windowLabel);

  const tabs: TabState[] = windowTabs.map((tab) => ({
    id: tab.id,
    file_path: tab.filePath,
    title: tab.title,
    is_pinned: tab.isPinned,
    document: captureDocumentState(tab.id, tab.filePath, tab.title, documentStore, historyStore),
  }));

  const activeTab = tabStore.getActiveTab(windowLabel);

  return {
    window_label: windowLabel,
    is_main_window: isMainWindow,
    active_tab_id: activeTab?.id || null,
    tabs,
    ui_state: getUiStateSafe(),
    geometry: null, // Window geometry capture not yet implemented
  };
}

export function useHotExitCapture() {
  useEffect(() => {
    const unlistenPromise = listen<CaptureRequest>(HOT_EXIT_EVENTS.CAPTURE_REQUEST, async (event) => {
      // Extract capture_id from request for correlation
      const captureId = event.payload?.capture_id ?? 'unknown';

      // Get current window inside callback to ensure it's available
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;
      // Only the window with label "main" is the main window
      // doc-* windows are secondary windows even if doc-0
      const isMainWindow = windowLabel === MAIN_WINDOW_LABEL;

      let response: CaptureResponse;

      try {
        const windowState = captureWindowState(windowLabel, isMainWindow);
        response = buildCaptureResponse(captureId, windowLabel, windowState);
      } catch (error) {
        console.error('[HotExit] Failed to capture window state:', error);

        // Build fallback state - getUiStateSafe won't throw
        const fallbackState: WindowState = {
          window_label: windowLabel,
          is_main_window: isMainWindow,
          active_tab_id: null,
          tabs: [],
          ui_state: getUiStateSafe(),
          geometry: null,
        };
        response = buildCaptureResponse(captureId, windowLabel, fallbackState);
      }

      // Emit response - this MUST succeed or coordinator blocks
      // Using window.emit() to ensure it reaches Rust app.listen()
      // (global emit() may not route to Rust properly in Tauri v2)
      try {
        await currentWindow.emit(HOT_EXIT_EVENTS.CAPTURE_RESPONSE, response);
      } catch (emitError) {
        // This is critical - log prominently
        console.error('[HotExit] CRITICAL: Failed to emit capture response:', emitError);
        // No fallback possible - coordinator will timeout
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch((e) => {
        // Log cleanup errors for debugging listener leaks (always log, useful for production debugging)
        console.warn('[HotExit] Cleanup error (may indicate listener leak):', e);
      });
    };
  }, []);
}
