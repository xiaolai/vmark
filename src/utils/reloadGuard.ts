/**
 * Reload Guard Logic
 *
 * Purpose: Pure helper for determining if browser/webview page reload
 * should be blocked due to unsaved changes (beforeunload equivalent).
 *
 * @coordinates-with closeDecision.ts — similar dirty-check logic for window close
 * @coordinates-with documentStore.ts — provides dirty tab IDs
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
