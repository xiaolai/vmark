/**
 * Workspace-related types for the bridge layer.
 * Covers Window, Tab, Workspace info, and reopened tab results.
 */

/**
 * Window info for list_windows resource.
 */
export interface WindowInfo {
  /** Window label (unique identifier) */
  label: string;
  /** Window title */
  title: string;
  /** File path (null for unsaved) */
  filePath: string | null;
  /** Whether this is the focused window */
  isFocused: boolean;
  /** Whether document is exposed to AI */
  isAiExposed: boolean;
}

/**
 * Workspace info response.
 */
export interface WorkspaceInfo {
  /** Whether currently in workspace mode */
  isWorkspaceMode: boolean;
  /** Workspace root path (null if not in workspace mode) */
  rootPath: string | null;
  /** Workspace name (folder name, null if not in workspace mode) */
  workspaceName: string | null;
}

/**
 * Reopened tab result.
 */
export interface ReopenedTabResult {
  /** ID of the reopened tab */
  tabId: string;
  /** File path of the reopened tab (null if untitled) */
  filePath: string | null;
  /** Title of the reopened tab */
  title: string;
}
