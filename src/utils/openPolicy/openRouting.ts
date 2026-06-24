/**
 * Open routing policy
 *
 * Purpose: Decide where and how to open a file based on workspace context, and
 * derive the workspace root for an external file. The multi-policy branch table
 * is split into focused helpers (existing tab → workspace boundary → rail mode →
 * external-file routing) so each policy can change without regressing the
 * others.
 *
 * @coordinates-with utils/paths/paths.ts — path normalization + boundary checks
 * @module utils/openPolicy/openRouting
 */

import { isWithinRoot, getParentDir, normalizePath } from "@/utils/paths/paths";
import type { OpenActionContext, OpenActionResult } from "./types";

/**
 * Resolve where and how to open a file based on workspace context.
 *
 * Decision logic (each step is a focused helper):
 * 1. If file already has an open tab, activate it
 * 2. If in workspace mode and file is within workspace, create a new tab
 * 3. If rail mode is on, keep the file in the current workbench
 * 4. Otherwise route the external file (new tab / replace / new window)
 */
export function resolveOpenAction(context: OpenActionContext): OpenActionResult {
  if (!context.filePath) {
    return { action: "no_op", reason: "empty_path" };
  }
  if (context.existingTabId) {
    return { action: "activate_tab", tabId: context.existingTabId };
  }

  const withinWorkspace = routeWithinWorkspace(context);
  if (withinWorkspace) return withinWorkspace;

  if (context.workspaceRailMode) {
    return routeRailMode(context);
  }

  return routeExternalFile(context);
}

/** Step 2 — a file inside the current workspace opens as a new tab in place. */
function routeWithinWorkspace(context: OpenActionContext): OpenActionResult | null {
  if (context.isWorkspaceMode && context.workspaceRoot) {
    if (isWithinRoot(context.workspaceRoot, context.filePath)) {
      return { action: "create_tab", filePath: context.filePath };
    }
  }
  return null;
}

/** Step 3 — rail mode keeps external files in the current workbench. */
function routeRailMode(context: OpenActionContext): OpenActionResult {
  if (context.replaceableTab && !context.openInNewTab) {
    return {
      action: "replace_tab",
      tabId: context.replaceableTab.tabId,
      filePath: context.filePath,
      workspaceRoot: null,
    };
  }
  return { action: "create_tab", filePath: context.filePath };
}

/**
 * Step 4 — route a file outside the current workspace. Resolves the file's own
 * folder as a workspace root and threads it through every action so ownership
 * never gets lost (the new-tab path carries the root so callers can claim it).
 */
function routeExternalFile(context: OpenActionContext): OpenActionResult {
  const newWorkspaceRoot = resolveWorkspaceRootForExternalFile(context.filePath);
  if (!newWorkspaceRoot) {
    return { action: "no_op", reason: "cannot_resolve_workspace_root" };
  }

  // fix(#946) — with "open in new tab" enabled, an external file that would
  // otherwise replace the clean untitled tab opens as a new tab instead, so the
  // empty tab is preserved. The resolved root travels with the action so the
  // caller can apply workspace ownership rather than attaching the file to the
  // current context.
  if (context.replaceableTab && context.openInNewTab) {
    return { action: "create_tab", filePath: context.filePath, workspaceRoot: newWorkspaceRoot };
  }

  // Replaceable tab present: replace it instead of opening a new window.
  if (context.replaceableTab) {
    return {
      action: "replace_tab",
      tabId: context.replaceableTab.tabId,
      filePath: context.filePath,
      workspaceRoot: newWorkspaceRoot,
    };
  }

  // No replaceable tab: open in a new window.
  return {
    action: "open_workspace_in_new_window",
    filePath: context.filePath,
    workspaceRoot: newWorkspaceRoot,
  };
}

/**
 * Get the parent folder of a file to use as workspace root.
 *
 * Used when opening a file from outside the current workspace. The file's
 * containing folder becomes the new workspace root.
 *
 * @returns Parent folder path, or null if it cannot be determined
 *
 * @example
 * resolveWorkspaceRootForExternalFile("/Users/test/project/file.md") // "/Users/test/project"
 * resolveWorkspaceRootForExternalFile("/file.md") // "/" (POSIX root is valid)
 */
export function resolveWorkspaceRootForExternalFile(filePath: string): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = normalizePath(filePath);
  const parentDir = getParentDir(normalized);

  if (!parentDir) {
    // A root-level POSIX file (e.g. "/file.md") has "/" as its containing
    // folder — a valid root. getParentDir returns "" for it, so recover the
    // POSIX root here instead of dropping the request as unresolvable.
    if (/^\/[^/]/.test(normalized)) {
      return "/";
    }
    return null;
  }

  // Windows drive root (e.g., "C:") is not a valid workspace root
  if (/^[A-Za-z]:$/.test(parentDir)) {
    return null;
  }

  return parentDir;
}
