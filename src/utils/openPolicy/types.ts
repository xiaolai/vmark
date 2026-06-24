/**
 * Open-policy shared types
 *
 * Purpose: Type definitions shared across the open/save/external-change policy
 * helpers. Split out of openPolicy.ts so each policy area lives in its own file
 * under the ~300-line guideline while the public types stay in one place.
 *
 * @module utils/openPolicy/types
 */

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
  /** Workspace rail mode keeps external files in the current workbench. */
  workspaceRailMode?: boolean;
}

/**
 * Result of resolving where to open a file.
 *
 * `create_tab` may carry a `workspaceRoot` so the caller can apply workspace
 * ownership for an external file opened in a new tab (omitted for in-workspace
 * and rail-mode opens, which stay in the current context).
 */
export type OpenActionResult =
  | { action: "create_tab"; filePath: string; workspaceRoot?: string | null }
  | { action: "activate_tab"; tabId: string }
  | { action: "replace_tab"; tabId: string; filePath: string; workspaceRoot: string | null }
  | { action: "open_workspace_in_new_window"; filePath: string; workspaceRoot: string }
  | { action: "no_op"; reason: string };

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
 * Tab info for determining if it's replaceable.
 */
export interface TabInfo {
  id: string;
  filePath: string | null;
  isDirty: boolean;
}
