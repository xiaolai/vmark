import { invoke } from '@tauri-apps/api/core';
import { hotExitLog, hotExitWarn } from '@/utils/debug';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore, TERMINAL_MAX_RATIO } from '@/stores/uiStore';
import { restoreDocumentState } from './restoreDocumentState';
import {
  clearExistingWindowTabs,
  deduplicateTabsByPath,
  filterMeaningfulTabs,
  restoreActiveTab,
  restoreTabMetadata,
} from './restoreTabsHelpers';
import type { WindowState } from './types';

/**
 * Maximum retries when pulling state (handles timing issues). Exported so the
 * restore coordinator reports the same retry count it actually applies —
 * keeping the log message and behavior from drifting apart.
 */
export const MAX_STATE_RETRIES = 5;
/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 100;
// Sidebar bounds come from uiStore — the store that actually clamps them.
// This file used to carry a 150-500 copy, so a persisted 500 passed validation
// and was then silently clamped to 480 by setSidebarWidth.
import {
  SIDEBAR_MIN_WIDTH as MIN_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH as MAX_SIDEBAR_WIDTH,
  SIDEBAR_DEFAULT_WIDTH as DEFAULT_SIDEBAR_WIDTH,
} from "@/stores/uiStore";

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

  // Per-tab isolation. `clearExistingWindowTabs` above has ALREADY destroyed
  // whatever the window had, so a throw here used to abandon the restore with
  // the fallback gone and only some tabs rebuilt — the worst of both states.
  // One bad tab now costs that tab, not the session.
  let failed = 0;
  for (const tabState of kept) {
    // createTab auto-activates; we set the active tab explicitly afterward.
    const newTabId = tabStore.createTab(windowLabel, tabState.file_path);
    try {
      restoreTabMetadata(windowLabel, newTabId, tabState);
      await restoreDocumentState(newTabId, tabState, documentStore);
      tabIdMap.set(tabState.id, newTabId);
    } catch (error) {
      failed += 1;
      hotExitWarn(
        `Failed to restore tab '${tabState.id}' (${tabState.file_path ?? 'untitled'}):`,
        error,
      );
      // Drop the half-built tab rather than presenting an empty document as a
      // restored one — an empty tab claiming a file path invites the user to
      // save over the real file.
      tabStore.detachTab(windowLabel, newTabId);
    }
  }
  if (failed > 0) {
    hotExitWarn(`Restored ${tabIdMap.size}/${kept.length} tabs for '${windowLabel}'`);
  }

  restoreActiveTab(windowLabel, windowState, tabIdMap, duplicateToRetained);

  return tabIdMap;
}
