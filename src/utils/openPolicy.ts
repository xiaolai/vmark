/**
 * Open Policy Helpers
 *
 * Pure decision logic for file opening, saving, and external change handling.
 * These helpers centralize VMark's workspace-first policies:
 *
 * - Always open in a new tab (activate existing tab if same file)
 * - External/outside-workspace opens a new window rooted at file's folder
 * - Missing files block normal Save (require Save As)
 * - External changes auto-reload clean docs, prompt for dirty docs
 *
 * IMPORTANT: These are pure functions - no React, Zustand, or Tauri imports.
 *
 * @module utils/openPolicy
 */
import { isWithinRoot, getParentDir, normalizePath } from "@/utils/paths/paths";

// -----------------------------------------------------------------------------
// resolveOpenAction
// -----------------------------------------------------------------------------

/**
 * Info about a tab that can be replaced instead of opening a new window.
 * A tab is replaceable if it's the only tab, is untitled, and is clean.
 */
export interface ReplaceableTabInfo {
  tabId: string;
}

/**
 * Context for resolving where to open a file.
 */
export interface OpenActionContext {
  /** Path to the file to open */
  filePath: string;
  /** Current workspace root (null if not in workspace mode) */
  workspaceRoot: string | null;
  /** Whether currently in workspace mode */
  isWorkspaceMode: boolean;
  /** ID of an existing tab for this file (null if none) */
  existingTabId: string | null;
  /** Info about a replaceable tab (single clean untitled tab), or null if none */
  replaceableTab: ReplaceableTabInfo | null;
  /**
   * fix(#946) — when true, prefer opening in a new tab over reusing the clean
   * untitled tab. Sourced from `general.openInNewTab`. Optional/falsy keeps the
   * legacy replace-the-empty-tab behavior, so existing users are unaffected.
   */
  openInNewTab?: boolean;
}

/**
 * Result of resolving where to open a file.
 */
export type OpenActionResult =
  | { action: "create_tab"; filePath: string }
  | { action: "activate_tab"; tabId: string }
  | { action: "replace_tab"; tabId: string; filePath: string; workspaceRoot: string }
  | { action: "open_workspace_in_new_window"; filePath: string; workspaceRoot: string }
  | { action: "no_op"; reason: string };

/**
 * Resolve where and how to open a file based on workspace context.
 *
 * Decision logic:
 * 1. If file already has an open tab, activate it
 * 2. If in workspace mode and file is within workspace, create new tab
 * 3. If `openInNewTab` is set and a replaceable tab exists, create a new tab
 *    (preserve the clean untitled tab) — fix(#946)
 * 4. If there's a replaceable tab (single clean untitled), replace it
 * 5. Otherwise, open in new window
 *
 * @param context - Current workspace and file context
 * @returns Action to take for opening the file
 *
 * @example
 * // File within workspace - create new tab
 * resolveOpenAction({
 *   filePath: "/project/src/file.md",
 *   workspaceRoot: "/project",
 *   isWorkspaceMode: true,
 *   existingTabId: null,
 *   replaceableTab: null,
 * }); // { action: "create_tab", filePath: "/project/src/file.md" }
 *
 * @example
 * // Clean untitled tab exists - replace it
 * resolveOpenAction({
 *   filePath: "/other/file.md",
 *   workspaceRoot: null,
 *   isWorkspaceMode: false,
 *   existingTabId: null,
 *   replaceableTab: { tabId: "tab-1" },
 * }); // { action: "replace_tab", tabId: "tab-1", ... }
 *
 * @example
 * // No replaceable tab - open new window
 * resolveOpenAction({
 *   filePath: "/other/file.md",
 *   workspaceRoot: "/project",
 *   isWorkspaceMode: true,
 *   existingTabId: null,
 *   replaceableTab: null,
 * }); // { action: "open_workspace_in_new_window", ... }
 */
export function resolveOpenAction(context: OpenActionContext): OpenActionResult {
  const { filePath, workspaceRoot, isWorkspaceMode, existingTabId, replaceableTab, openInNewTab } = context;

  // Guard: empty path
  if (!filePath) {
    return { action: "no_op", reason: "empty_path" };
  }

  // If file already has a tab open, activate it
  if (existingTabId) {
    return { action: "activate_tab", tabId: existingTabId };
  }

  // In workspace mode: check if file is within workspace
  if (isWorkspaceMode && workspaceRoot) {
    if (isWithinRoot(workspaceRoot, filePath)) {
      return { action: "create_tab", filePath };
    }
  }

  // Resolve workspace root for external file
  const newWorkspaceRoot = resolveWorkspaceRootForExternalFile(filePath);
  if (!newWorkspaceRoot) {
    return { action: "no_op", reason: "cannot_resolve_workspace_root" };
  }

  // fix(#946) — with "open in new tab" enabled, an external file that would
  // otherwise replace the clean untitled tab opens as a new tab in the current
  // window instead, so the empty tab is preserved.
  if (replaceableTab && openInNewTab) {
    return { action: "create_tab", filePath };
  }

  // If there's a replaceable tab (single clean untitled), replace it instead of new window
  if (replaceableTab) {
    return {
      action: "replace_tab",
      tabId: replaceableTab.tabId,
      filePath,
      workspaceRoot: newWorkspaceRoot,
    };
  }

  // No replaceable tab: open in new window
  return {
    action: "open_workspace_in_new_window",
    filePath,
    workspaceRoot: newWorkspaceRoot,
  };
}

// -----------------------------------------------------------------------------
// resolveWorkspaceRootForExternalFile
// -----------------------------------------------------------------------------

/**
 * Get the parent folder of a file to use as workspace root.
 *
 * Used when opening a file from outside the current workspace.
 * The file's containing folder becomes the new workspace root.
 *
 * @param filePath - Path to the file
 * @returns Parent folder path, or null if cannot be determined
 *
 * @example
 * resolveWorkspaceRootForExternalFile("/Users/test/project/file.md")
 * // Returns "/Users/test/project"
 *
 * @example
 * resolveWorkspaceRootForExternalFile("/file.md")
 * // Returns null (root-level file)
 */
export function resolveWorkspaceRootForExternalFile(filePath: string): string | null {
  if (!filePath) {
    return null;
  }

  // Normalize and get parent directory
  const normalized = normalizePath(filePath);
  const parentDir = getParentDir(normalized);

  // Return null if we're at root level (no valid parent)
  if (!parentDir) {
    return null;
  }

  // Windows drive root (e.g., "C:") is not a valid workspace root
  if (/^[A-Za-z]:$/.test(parentDir)) {
    return null;
  }

  return parentDir;
}

// -----------------------------------------------------------------------------
// resolveMissingFileSaveAction
// -----------------------------------------------------------------------------

/**
 * Context for missing file save decisions.
 */
export interface MissingFileSaveContext {
  /** Whether the file is marked as missing on disk */
  isMissing: boolean;
  /** Whether the document has a file path */
  hasPath: boolean;
}

/**
 * Actions for saving a potentially missing file.
 */
export type MissingFileSaveAction = "save_as_required" | "allow_save";

/**
 * Determine if a save operation should be blocked due to missing file.
 *
 * When a file is marked as missing (deleted from disk while open),
 * we require Save As to prevent accidentally recreating the file
 * at the original location without user intent.
 *
 * @param context - Missing file context
 * @returns Whether normal save is allowed or Save As is required
 *
 * @example
 * // File deleted while open - block normal save
 * resolveMissingFileSaveAction({ isMissing: true, hasPath: true })
 * // Returns "save_as_required"
 *
 * @example
 * // Normal saved file - allow save
 * resolveMissingFileSaveAction({ isMissing: false, hasPath: true })
 * // Returns "allow_save"
 */
export function resolveMissingFileSaveAction(
  context: MissingFileSaveContext
): MissingFileSaveAction {
  const { isMissing, hasPath } = context;

  // Only block save if file is missing AND has a path
  // (missing without path is a theoretical edge case)
  if (isMissing && hasPath) {
    return "save_as_required";
  }

  return "allow_save";
}

// -----------------------------------------------------------------------------
// resolveExternalChangeAction
// -----------------------------------------------------------------------------

/**
 * Context for external file change decisions.
 */
export interface ExternalChangeContext {
  /** Whether the document has unsaved changes */
  isDirty: boolean;
  /** Whether the document has a file path */
  hasFilePath: boolean;
}

/**
 * Actions for handling external file changes.
 */
export type ExternalChangeAction = "auto_reload" | "prompt_user" | "no_op";

/**
 * Determine how to handle an external file change event.
 *
 * Policy:
 * - Clean documents: auto-reload silently
 * - Dirty documents: prompt user to choose
 * - Unsaved (no path): ignore external changes
 *
 * @param context - External change context
 * @returns Action to take for the external change
 *
 * @example
 * // Clean document - auto reload
 * resolveExternalChangeAction({ isDirty: false, hasFilePath: true })
 * // Returns "auto_reload"
 *
 * @example
 * // Dirty document - prompt user
 * resolveExternalChangeAction({ isDirty: true, hasFilePath: true })
 * // Returns "prompt_user"
 */
export function resolveExternalChangeAction(
  context: ExternalChangeContext
): ExternalChangeAction {
  const { isDirty, hasFilePath } = context;

  // No file path means no external file to track
  if (!hasFilePath) {
    return "no_op";
  }

  // Dirty docs need user decision
  if (isDirty) {
    return "prompt_user";
  }

  // Clean docs auto-reload
  return "auto_reload";
}

// -----------------------------------------------------------------------------
// resolvePostSaveWorkspaceAction
// -----------------------------------------------------------------------------

/**
 * Context for post-save workspace decisions.
 */
export interface PostSaveWorkspaceContext {
  /** Whether the window is currently in workspace mode */
  isWorkspaceMode: boolean;
  /** Whether the document had a file path before save (was it untitled?) */
  hadPathBeforeSave: boolean;
  /** The path where the file was just saved */
  savedFilePath: string;
}

/**
 * Result of post-save workspace decision.
 */
export type PostSaveWorkspaceAction =
  | { action: "open_workspace"; workspaceRoot: string }
  | { action: "no_op" };

/**
 * Determine if a workspace should be opened after saving an untitled file.
 *
 * Policy:
 * - If not in workspace mode AND file was untitled AND save succeeded,
 *   auto-open the file's containing folder as a workspace.
 * - Otherwise, do nothing.
 *
 * @param context - Post-save context
 * @returns Action to take after save
 *
 * @example
 * // Untitled file saved while not in workspace mode - open workspace
 * resolvePostSaveWorkspaceAction({
 *   isWorkspaceMode: false,
 *   hadPathBeforeSave: false,
 *   savedFilePath: "/Users/test/project/file.md"
 * }); // { action: "open_workspace", workspaceRoot: "/Users/test/project" }
 *
 * @example
 * // Already in workspace mode - no action
 * resolvePostSaveWorkspaceAction({
 *   isWorkspaceMode: true,
 *   hadPathBeforeSave: false,
 *   savedFilePath: "/workspace/file.md"
 * }); // { action: "no_op" }
 */
export function resolvePostSaveWorkspaceAction(
  context: PostSaveWorkspaceContext
): PostSaveWorkspaceAction {
  const { isWorkspaceMode, hadPathBeforeSave, savedFilePath } = context;

  // Already in workspace mode - no need to open workspace
  if (isWorkspaceMode) {
    return { action: "no_op" };
  }

  // File was already saved (had path) - not a first-save scenario
  if (hadPathBeforeSave) {
    return { action: "no_op" };
  }

  // No saved path - edge case, shouldn't happen
  if (!savedFilePath) {
    return { action: "no_op" };
  }

  // Get parent folder to use as workspace root
  const workspaceRoot = resolveWorkspaceRootForExternalFile(savedFilePath);
  if (!workspaceRoot) {
    return { action: "no_op" };
  }

  return { action: "open_workspace", workspaceRoot };
}

// -----------------------------------------------------------------------------
// findReplaceableTab
// -----------------------------------------------------------------------------

/**
 * Tab info for determining if it's replaceable.
 */
export interface TabInfo {
  id: string;
  filePath: string | null;
  isDirty: boolean;
}

/**
 * Find a replaceable tab in the given tabs list.
 *
 * A tab is replaceable if:
 * 1. It's the only tab in the window
 * 2. It's untitled (no filePath)
 * 3. It's clean (not dirty)
 *
 * @param tabs - List of tabs in the window
 * @returns ReplaceableTabInfo if found, null otherwise
 *
 * @example
 * // Single clean untitled tab - replaceable
 * findReplaceableTab([{ id: "tab-1", filePath: null, isDirty: false }])
 * // { tabId: "tab-1" }
 *
 * @example
 * // Multiple tabs - not replaceable
 * findReplaceableTab([
 *   { id: "tab-1", filePath: null, isDirty: false },
 *   { id: "tab-2", filePath: "/file.md", isDirty: false },
 * ])
 * // null
 */
export function findReplaceableTab(tabs: TabInfo[]): ReplaceableTabInfo | null {
  // Must have exactly one tab
  if (tabs.length !== 1) {
    return null;
  }

  const tab = tabs[0];

  // Must be untitled (no filePath)
  if (tab.filePath !== null) {
    return null;
  }

  // Must be clean (not dirty)
  if (tab.isDirty) {
    return null;
  }

  return { tabId: tab.id };
}
