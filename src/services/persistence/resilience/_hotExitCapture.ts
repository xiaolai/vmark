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
import { useDocumentStore, useUnifiedHistoryStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import type { WindowState, TabState, CaptureRequest, CaptureResponse } from '../hotExit/types';
import { HOT_EXIT_EVENTS, MAIN_WINDOW_LABEL } from '../hotExit/types';
import { hotExitWarn, hotExitError } from '@/utils/debug';
import { captureWindowWorkspaceInstances } from '../hotExit/workspaceInstances';
import { captureWindowGeometry } from './windowGeometry';
import {
  extractUntitledNumber,
  toHotExitCheckpoint,
  toHotExitCursorInfo,
  toHotExitLineEnding,
} from './_hotExitCaptureConvert';

/**
 * Gather UI state from stores (safe - catches errors)
 */
function getUiStateSafe() {
  try {
    // Post-ADR-009: sidebar flags AND editor-view flags (sourceMode,
    // focusMode, typewriterMode) live on a single uiStore. One read covers
    // both surfaces — the earlier duplicate `editorStore` alias was a fake
    // separation reading the same state.
    const uiState = useUIStore.getState();

    return {
      sidebar_visible: uiState.sidebarVisible,
      sidebar_width: uiState.sidebarWidth,
      outline_visible: false, // deprecated — kept for backward compat with saved data
      sidebar_view_mode: uiState.sidebarViewMode,
      status_bar_visible: uiState.statusBarVisible,
      source_mode_enabled: uiState.sourceMode,
      focus_mode_enabled: uiState.focusModeEnabled,
      typewriter_mode_enabled: uiState.typewriterModeEnabled,
      terminal_visible: uiState.terminalVisible,
      terminal_height: uiState.terminalHeight,
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

/** A document that exists in the document store (capture skips tabs without one). */
type CapturedDocument = NonNullable<
  ReturnType<ReturnType<typeof useDocumentStore.getState>['getDocument']>
>;

/** Cap persisted undo/redo depth to keep IPC/serialization size bounded. */
const MAX_HISTORY_CHECKPOINTS = 20;

/**
 * Capture document state for a tab.
 *
 * Takes the live document rather than looking it up: a tab whose document is
 * absent from the store has NOTHING to capture, and persisting an empty
 * document for a real file path would restore that file as an empty buffer
 * (a later save then truncates it on disk). `captureWindowState` drops such
 * tabs instead.
 */
function captureDocumentState(
  filePath: string | null,
  title: string,
  doc: CapturedDocument,
  historyStore: ReturnType<typeof useUnifiedHistoryStore.getState>,
  tabId: string
) {
  const docHistory = historyStore.documents[tabId];
  const undoHistory = (docHistory?.undoStack ?? []).slice(-MAX_HISTORY_CHECKPOINTS).map(toHotExitCheckpoint);
  const redoHistory = (docHistory?.redoStack ?? []).slice(-MAX_HISTORY_CHECKPOINTS).map(toHotExitCheckpoint);

  // Compute untitled state once
  const isUntitled = !filePath;
  const untitledNumber = isUntitled ? extractUntitledNumber(title) : null;

  return {
    content: doc.content,
    saved_content: doc.savedContent,
    is_dirty: doc.isDirty,
    is_missing: doc.isMissing,
    is_divergent: doc.isDivergent,
    is_read_only: doc.readOnly,
    line_ending: toHotExitLineEnding(doc.lineEnding),
    cursor_info: toHotExitCursorInfo(doc.cursorInfo),
    last_modified_timestamp: doc.lastAutoSave,
    is_untitled: isUntitled,
    untitled_number: untitledNumber,
    undo_history: undoHistory,
    redo_history: redoHistory,
    mode: doc.mode,
    hard_break_style: doc.hardBreakStyle,
    last_disk_content: doc.lastDiskContent,
  };
}

/**
 * Capture complete window state.
 *
 * Exported for direct unit testing of the capture payload (WI-1A.13:
 * format_id / editing_enabled / active_schema_id population). The hook
 * uses this internally to respond to capture requests from Rust.
 */
export function captureWindowState(windowLabel: string, isMainWindow: boolean): WindowState {
  const tabStore = useTabStore.getState();
  const documentStore = useDocumentStore.getState();
  const historyStore = useUnifiedHistoryStore.getState();

  // Get tabs for this window. Browser tabs (WI-1.1 / R1) carry no document
  // content to crash-recover; they are restored from the workspace session
  // config (`sessionTabs`), not from this crash snapshot — so capture only
  // document tabs here.
  const windowTabs = tabStore
    .getTabsByWindow(windowLabel)
    .filter((tab) => tab.kind === "document");

  const tabs: TabState[] = [];
  for (const tab of windowTabs) {
    const doc = documentStore.getDocument(tab.id);
    if (!doc) {
      // Inconsistent state (tab without document). Capturing it would persist
      // an empty document for this tab's file path — restore would then show
      // the file as empty and a save would truncate it. Nothing to recover.
      hotExitError('Skipping tab with no document state:', tab.id, tab.filePath);
      continue;
    }
    tabs.push({
      id: tab.id,
      file_path: tab.filePath,
      title: tab.title,
      is_pinned: tab.isPinned,
      document: captureDocumentState(tab.filePath, tab.title, doc, historyStore, tab.id),
      // Multi-format fields (WI-1A.13). `formatId` is always present on
      // the in-memory Tab; the other two have store-defined defaults.
      format_id: tab.formatId,
      editing_enabled: tab.editingEnabled ?? true,
      active_schema_id: tab.activeSchemaId ?? null,
    });
  }

  // The active tab must be one of the CAPTURED tabs. A browser tab (filtered
  // out above) or a dropped inconsistent tab would otherwise persist an
  // active_tab_id that no restored tab carries, which restore then repairs to
  // an arbitrary document — and workspace activation follows that wrong tab.
  const activeTab = tabStore.getActiveTab(windowLabel);
  const activeTabId =
    activeTab && tabs.some((tab) => tab.id === activeTab.id) ? activeTab.id : null;

  return {
    window_label: windowLabel,
    is_main_window: isMainWindow,
    active_tab_id: activeTabId,
    tabs,
    ui_state: getUiStateSafe(),
    geometry: captureWindowGeometry(),
    ...captureWindowWorkspaceInstances(windowLabel),
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
        // Do NOT emit a fabricated empty-success response. The Rust coordinator
        // would count this window as "captured with zero tabs" and overwrite
        // the previous recoverable snapshot with nothing — a data-loss path.
        // Emitting no response instead lets the coordinator time out for this
        // window; `merge_partial_capture` then resurrects the window's previous
        // state (partial capture), or `hot_exit_capture` aborts the write
        // entirely when this is the only window (zero responses → Err). Either
        // way the last good snapshot survives. The tradeoff is a one-time quit
        // delay (up to the coordinator's capture timeout) on the rare capture
        // exception, which is worth avoiding document loss.
        hotExitError(
          'Failed to capture window state; emitting no response so Rust keeps the previous snapshot:',
          error,
        );
        return;
      }

      // Emit response - this MUST succeed or coordinator blocks
      // Using window.emit() to ensure it reaches Rust app.listen()
      // (global emit() may not route to Rust properly in Tauri v2)
      try {
        await currentWindow.emit(HOT_EXIT_EVENTS.CAPTURE_RESPONSE, response);
      } catch (emitError) {
        // This is critical - log prominently
        hotExitError('CRITICAL: Failed to emit capture response:', emitError);
        // No fallback possible - coordinator will timeout
      }
    })
      // Handle a failed registration HERE, not at unmount: a rejected listen()
      // silently disables hot-exit capture for this window (the coordinator
      // then times out on quit) and would surface only as an unhandled
      // rejection. Resolve to a no-op unlisten so cleanup stays safe.
      .catch((error: unknown) => {
        hotExitError('CRITICAL: Failed to register hot-exit capture listener:', error);
        return () => {};
      });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch((e) => {
        // Log cleanup errors for debugging listener leaks (always log, useful for production debugging)
        hotExitWarn('Cleanup error (may indicate listener leak):', e);
      });
    };
  }, []);
}
