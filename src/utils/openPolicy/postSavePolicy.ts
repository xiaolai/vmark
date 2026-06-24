/**
 * Post-save workspace policy
 *
 * Purpose: Decide whether saving a previously-untitled file (while not in
 * workspace mode) should auto-open the file's containing folder as a workspace.
 *
 * @coordinates-with utils/openPolicy/openRouting.ts — reuses external-file root resolution
 * @module utils/openPolicy/postSavePolicy
 */

import { resolveWorkspaceRootForExternalFile } from "./openRouting";
import type { PostSaveWorkspaceAction, PostSaveWorkspaceContext } from "./types";

/**
 * Determine if a workspace should be opened after saving an untitled file.
 *
 * Policy:
 * - If not in workspace mode AND file was untitled AND save succeeded,
 *   auto-open the file's containing folder as a workspace.
 * - Otherwise, do nothing.
 *
 * @example
 * resolvePostSaveWorkspaceAction({
 *   isWorkspaceMode: false, hadPathBeforeSave: false,
 *   savedFilePath: "/Users/test/project/file.md",
 * }); // { action: "open_workspace", workspaceRoot: "/Users/test/project" }
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
