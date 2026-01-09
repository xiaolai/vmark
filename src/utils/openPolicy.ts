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
}

/**
 * Result of resolving where to open a file.
 */
export type OpenActionResult =
  | { action: "create_tab"; filePath: string }
  | { action: "activate_tab"; tabId: string }
  | { action: "open_workspace_in_new_window"; filePath: string; workspaceRoot: string }
  | { action: "no_op"; reason: string };

/**
 * Resolve where and how to open a file based on workspace context.
 *
 * Decision logic:
 * 1. If file already has an open tab, activate it
 * 2. If in workspace mode and file is within workspace, create new tab
 * 3. If file is outside workspace (or not in workspace mode), open in new window
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
 * }); // { action: "create_tab", filePath: "/project/src/file.md" }
 *
 * @example
 * // File outside workspace - open new window
 * resolveOpenAction({
 *   filePath: "/other/file.md",
 *   workspaceRoot: "/project",
 *   isWorkspaceMode: true,
 *   existingTabId: null,
 * }); // { action: "open_workspace_in_new_window", ... }
 */
export function resolveOpenAction(context: OpenActionContext): OpenActionResult {
  const { filePath, workspaceRoot, isWorkspaceMode, existingTabId } = context;

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

  // Outside workspace or not in workspace mode: open in new window
  const newWorkspaceRoot = resolveWorkspaceRootForExternalFile(filePath);
  if (!newWorkspaceRoot) {
    return { action: "no_op", reason: "cannot_resolve_workspace_root" };
  }

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
