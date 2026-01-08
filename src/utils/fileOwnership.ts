/**
 * File Ownership Logic
 *
 * Pure helpers for determining which workspace window should handle
 * a file opened from the OS (e.g., Finder double-click).
 *
 * Ownership rules:
 * 1. Workspace window owns files within its rootPath
 * 2. Non-workspace (main) window handles files outside all workspaces
 * 3. If multiple workspaces could claim a file (nested roots), prefer deepest match
 */

import { normalizePath, isWithinRoot } from "./paths";

/**
 * Input for file ownership check
 */
export interface FileOwnershipInput {
  /** Path of the file being opened */
  filePath: string;
  /** Whether this window is in workspace mode */
  isWorkspaceMode: boolean;
  /** Root path of the workspace (if in workspace mode) */
  workspaceRoot: string | null;
}

/**
 * Result of file ownership check
 */
export type FileOwnershipResult =
  | { shouldClaim: true; reason: "within_workspace" }
  | { shouldClaim: true; reason: "no_workspace_fallback" }
  | { shouldClaim: false; reason: "outside_workspace" }
  | { shouldClaim: false; reason: "invalid_input" };

/**
 * Determine if this window should claim ownership of a file.
 *
 * In workspace mode: only claim files within the workspace root.
 * In non-workspace mode: claim files as fallback (main window handles stragglers).
 *
 * @param input - File path and window workspace context
 * @returns Whether this window should claim the file
 */
export function shouldClaimFile(input: FileOwnershipInput): FileOwnershipResult {
  const { isWorkspaceMode, workspaceRoot } = input;
  const filePath = normalizePath(input.filePath);

  if (!filePath) {
    return { shouldClaim: false, reason: "invalid_input" };
  }

  if (isWorkspaceMode) {
    if (!workspaceRoot) {
      return { shouldClaim: false, reason: "invalid_input" };
    }
    const normalizedRoot = normalizePath(workspaceRoot);
    if (isWithinRoot(normalizedRoot, filePath)) {
      return { shouldClaim: true, reason: "within_workspace" };
    }
    return { shouldClaim: false, reason: "outside_workspace" };
  }

  // Non-workspace mode: claim as fallback
  return { shouldClaim: true, reason: "no_workspace_fallback" };
}

/**
 * Priority for file ownership claims.
 * Higher priority windows should claim before lower priority.
 *
 * - Workspace windows with matching root: priority = depth of root path
 * - Non-workspace windows: priority = -1 (lowest, fallback)
 *
 * @param input - File path and window workspace context
 * @returns Priority score (higher = should claim first)
 */
export function getClaimPriority(input: FileOwnershipInput): number {
  const { isWorkspaceMode, workspaceRoot } = input;
  const filePath = normalizePath(input.filePath);

  if (!filePath) return -Infinity;

  if (isWorkspaceMode && workspaceRoot) {
    const normalizedRoot = normalizePath(workspaceRoot);
    if (isWithinRoot(normalizedRoot, filePath)) {
      // Priority = depth of workspace root (deeper = more specific)
      const depth = normalizedRoot.split("/").filter(Boolean).length;
      return depth;
    }
    // File not in this workspace - don't claim
    return -Infinity;
  }

  // Non-workspace fallback
  return -1;
}
