/**
 * Path Reconciliation Logic
 *
 * Purpose: Pure helpers for determining how to update open tabs/documents
 * when files are renamed, moved, or deleted in the file explorer.
 *
 * Follow-file semantics:
 * - Rename/move: update tab/document to point to new path
 * - Delete: mark tab/document as missing (show warning UI)
 *
 * Key decisions:
 *   - Handles both direct file matches and files inside renamed/moved folders
 *   - Folder prefix detection uses trailing "/" to prevent "/Users/root" matching "/Users/rootother"
 *   - Pure function — no store access, no side effects (caller applies results)
 *
 * @coordinates-with useExplorerOperations.ts — calls reconcilePathChange after file ops
 * @coordinates-with tabStore.ts — caller updates tab paths with reconcile results
 * @coordinates-with documentStore.ts — caller marks documents as missing
 * @module utils/pathReconciliation
 */

import { normalizePath } from "./paths";

/**
 * Input for path change reconciliation
 */
export interface PathChangeInput {
  /** Type of change */
  changeType: "rename" | "move" | "delete";
  /** Original path of the file/folder */
  oldPath: string;
  /** New path (undefined for delete) */
  newPath?: string;
  /** Array of currently open file paths */
  openFilePaths: string[];
}

/**
 * Result of reconciliation for a single file
 */
export type ReconcileResult =
  | { action: "update_path"; oldPath: string; newPath: string }
  | { action: "mark_missing"; oldPath: string };

/**
 * Reconcile path changes to determine which open files need updating.
 *
 * For rename/move:
 * - Direct file match → update path
 * - File inside moved folder → update path prefix
 *
 * For delete:
 * - Direct file match → mark missing
 * - File inside deleted folder → mark missing
 *
 * @param input - Path change details and open files
 * @returns Array of reconciliation results
 */
export function reconcilePathChange(input: PathChangeInput): ReconcileResult[] {
  const { changeType, openFilePaths } = input;
  const oldPath = normalizePath(input.oldPath);
  const newPath = input.newPath ? normalizePath(input.newPath) : undefined;

  const results: ReconcileResult[] = [];

  for (const filePath of openFilePaths) {
    const normalizedFilePath = normalizePath(filePath);

    // Check for direct match
    if (normalizedFilePath === oldPath) {
      if (changeType === "delete") {
        results.push({ action: "mark_missing", oldPath: normalizedFilePath });
      } else if (newPath) {
        results.push({
          action: "update_path",
          oldPath: normalizedFilePath,
          newPath,
        });
      }
      continue;
    }

    // Check if file is inside the changed folder
    const folderPrefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
    if (normalizedFilePath.startsWith(folderPrefix)) {
      if (changeType === "delete") {
        results.push({ action: "mark_missing", oldPath: normalizedFilePath });
      } else if (newPath) {
        // Replace old folder prefix with new folder prefix
        const newFolderPrefix = newPath.endsWith("/") ? newPath : newPath + "/";
        const relativePath = normalizedFilePath.slice(folderPrefix.length);
        const newFilePath = newFolderPrefix + relativePath;
        results.push({
          action: "update_path",
          oldPath: normalizedFilePath,
          newPath: newFilePath,
        });
      }
    }
  }

  return results;
}
