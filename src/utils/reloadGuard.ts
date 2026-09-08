/**
 * Reload Guard Logic
 *
 * Purpose: Pure helpers for reload prevention. Includes dirty-document
 *   checks (dev mode), keyboard shortcut detection (production mode),
 *   and terminal focus detection (to let Ctrl+R pass through to the shell).
 *
 * @coordinates-with services/windowClose/windowCloseFlow.ts — the window-close counterpart of the dirty check
 * @coordinates-with documentStore.ts — provides dirty tab IDs
 * @coordinates-with useReloadGuard.ts — hook that consumes these helpers
 * @module utils/reloadGuard
 */

/**
 * Input for reload guard check
 */
export interface ReloadGuardInput {
  /** List of dirty document tab IDs */
  dirtyTabIds: string[];
}

/**
 * Result of reload guard check
 */
export type ReloadGuardResult =
  | { shouldBlock: true; reason: "unsaved_changes"; count: number }
  | { shouldBlock: false };

/**
 * Determine if page reload should be blocked.
 *
 * @param input - Current dirty document state
 * @returns Whether reload should be blocked and why
 */
export function shouldBlockReload(input: ReloadGuardInput): ReloadGuardResult {
  const { dirtyTabIds } = input;

  if (dirtyTabIds.length > 0) {
    return {
      shouldBlock: true,
      reason: "unsaved_changes",
      count: dirtyTabIds.length,
    };
  }

  return { shouldBlock: false };
}

/**
 * Get the warning message for unsaved changes.
 *
 * @param count - Number of unsaved documents
 * @returns User-friendly warning message
 */
export function getReloadWarningMessage(count: number): string {
  if (count === 1) {
    return "You have unsaved changes. Are you sure you want to leave?";
  }
  return `You have ${count} documents with unsaved changes. Are you sure you want to leave?`;
}

/**
 * Check if a keyboard event is a browser/webview reload shortcut.
 *
 * Detected shortcuts:
 *   - Cmd+R / Ctrl+R
 *   - Cmd+Shift+R / Ctrl+Shift+R
 *
 * Note: F5 is NOT included here — it is used as the Source Peek shortcut.
 * Tauri's webview does not reload on bare F5 (unlike browsers), so
 * blocking it would only prevent the Source Peek feature from working.
 */
export function isReloadShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") return true;
  return false;
}

/**
 * Check if the currently focused element is inside the integrated terminal.
 *
 * When the terminal is focused (xterm's hidden textarea), keyboard shortcuts
 * like Ctrl+R should pass through to the shell (e.g., zsh reverse-i-search)
 * instead of being intercepted by the reload guard.
 */
/** CSS selector for the terminal container — shared with TerminalPanel.tsx className. */
const TERMINAL_CONTAINER_SELECTOR = ".terminal-container";

export function isTerminalFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.closest(TERMINAL_CONTAINER_SELECTOR) !== null;
}

/**
 * Check if a keyboard event is Ctrl+R specifically (not Cmd+R).
 *
 * Only Ctrl+R should pass through to the terminal for shell reverse-i-search.
 * Cmd+R is a reload shortcut on macOS and must always be blocked.
 */
export function isCtrlR(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): boolean {
  return e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r";
}
