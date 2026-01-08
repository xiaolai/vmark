/**
 * Open File Command
 *
 * Pure decision logic for opening files in tabs.
 * Separates "what should happen" from side effects (file I/O, store updates).
 *
 * Design:
 * - By default, files open in a new tab (workspace-first design)
 * - Option to reuse an existing tab if one exists for the file
 * - Pure functions return actions to execute, not side effects
 */

/**
 * Options for tab reuse behavior
 */
export interface OpenInTabOptions {
  /** If true and a tab exists for this file, activate it instead of creating new */
  reuseExistingTab?: boolean;
  /** ID of an existing tab for this file (if known) */
  existingTabId?: string | null;
}

/**
 * Determine if a file should open in a new tab.
 *
 * VMark's workspace-first design defaults to always creating new tabs.
 * This can be overridden for specific flows.
 *
 * @param options - Tab reuse options
 * @returns true if a new tab should be created
 */
export function shouldOpenInNewTab(options: OpenInTabOptions = {}): boolean {
  const { reuseExistingTab = false, existingTabId = null } = options;

  if (reuseExistingTab && existingTabId) {
    return false; // Reuse existing tab
  }

  return true; // Default: create new tab
}

/**
 * Context for resolving where to open a file.
 */
export interface OpenFileContext {
  /** Path to the file to open */
  filePath: string;
  /** Window label for the target window */
  windowLabel: string;
  /** ID of an existing tab for this file (if any) */
  existingTabId: string | null;
  /** Whether to reuse an existing tab */
  reuseExistingTab?: boolean;
}

/**
 * Result of resolving where to open a file.
 */
export type OpenFileResult =
  | { action: "create_tab"; filePath: string; windowLabel: string }
  | { action: "activate_tab"; tabId: string; windowLabel: string }
  | { action: "no_op"; reason: string };

/**
 * Resolve where to open a file based on context.
 *
 * Pure function that returns the action to take without side effects.
 *
 * @param context - Context for the open operation
 * @returns Result describing what action to take
 */
export function resolveOpenTarget(context: OpenFileContext): OpenFileResult {
  const { filePath, windowLabel, existingTabId, reuseExistingTab = false } = context;

  // Guard: empty path
  if (!filePath) {
    return { action: "no_op", reason: "empty_path" };
  }

  // Check if we should reuse an existing tab
  const openNew = shouldOpenInNewTab({
    reuseExistingTab,
    existingTabId,
  });

  if (!openNew && existingTabId) {
    return { action: "activate_tab", tabId: existingTabId, windowLabel };
  }

  return { action: "create_tab", filePath, windowLabel };
}
