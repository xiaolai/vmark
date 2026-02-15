/**
 * History Recovery (Hooks Layer)
 *
 * Purpose: Recovery and bulk-clearing operations for document history —
 *   lists documents that have history but no longer exist on disk, restores
 *   them from their most recent snapshot, deletes history per-document or
 *   per-workspace, or permanently clears all history.
 *
 * Key decisions:
 *   - Scans the history directory for entries whose original file is missing
 *   - Restore writes the latest snapshot content back to the original path
 *   - Permanent delete removes both index and all snapshot files
 *   - Workspace clearing uses normalizePath + isWithinRoot for path matching
 *
 * @coordinates-with useHistoryOperations.ts — creates/manages active history
 * @coordinates-with historyTypes.ts — shared types and folder constants
 * @module hooks/useHistoryRecovery
 */

import {
  exists,
  readTextFile,
  writeTextFile,
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { historyLog } from "@/utils/debug";
import {
  type HistoryIndex,
  type DeletedDocument,
  INDEX_FILE,
  getDocumentName,
  hashPath,
} from "@/utils/historyTypes";
import { normalizePath, isWithinRoot } from "@/utils/paths/paths";
import { getHistoryBaseDir } from "@/hooks/useHistoryOperations";

// Re-export type for consumers
export type { DeletedDocument };

/**
 * Get all deleted documents that have history
 */
export async function getDeletedDocuments(): Promise<DeletedDocument[]> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (!(await exists(baseDir))) return [];

    const entries = await readDir(baseDir);
    const deleted: DeletedDocument[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      try {
        const indexPath = await join(baseDir, entry.name, INDEX_FILE);
        if (!(await exists(indexPath))) continue;

        const content = await readTextFile(indexPath);
        const index = JSON.parse(content) as HistoryIndex;

        if (index.status === "deleted" && index.snapshots.length > 0) {
          const latestSnapshot = index.snapshots[index.snapshots.length - 1];
          deleted.push({
            pathHash: index.pathHash,
            documentName: index.documentName,
            lastPath: index.documentPath,
            deletedAt: index.deletedAt || 0,
            snapshotCount: index.snapshots.length,
            latestPreview: latestSnapshot.preview,
          });
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Sort by deletion date descending
    return deleted.sort((a, b) => b.deletedAt - a.deletedAt);
  } catch (error) {
    console.error("[History] Failed to get deleted documents:", error);
    return [];
  }
}

/**
 * Restore a deleted document's latest version to a new path
 */
export async function restoreDeletedDocument(
  pathHash: string,
  newPath: string
): Promise<string | null> {
  try {
    const baseDir = await getHistoryBaseDir();
    const historyDir = await join(baseDir, pathHash);
    const indexPath = await join(historyDir, INDEX_FILE);

    if (!(await exists(indexPath))) {
      console.error("[History] No history found for hash:", pathHash);
      return null;
    }

    const content = await readTextFile(indexPath);
    const index = JSON.parse(content) as HistoryIndex;

    if (index.snapshots.length === 0) {
      console.error("[History] No snapshots to restore");
      return null;
    }

    // Get latest snapshot
    const latestSnapshot = index.snapshots[index.snapshots.length - 1];
    const snapshotPath = await join(historyDir, `${latestSnapshot.id}.md`);
    const snapshotContent = await readTextFile(snapshotPath);

    // Update index with new path
    index.documentPath = newPath;
    index.documentName = getDocumentName(newPath);
    index.status = "active";
    index.deletedAt = null;

    // Save updated index (note: still at old hash location)
    await writeTextFile(indexPath, JSON.stringify(index, null, 2));

    historyLog("Restored document to:", newPath);
    return snapshotContent;
  } catch (error) {
    console.error("[History] Failed to restore document:", error);
    return null;
  }
}

/**
 * Permanently delete history for a document
 */
export async function deleteHistory(pathHash: string): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    const historyDir = await join(baseDir, pathHash);

    if (await exists(historyDir)) {
      await remove(historyDir, { recursive: true });
      historyLog("Deleted history for:", pathHash);
    }
  } catch (error) {
    console.error("[History] Failed to delete history:", error);
  }
}

/**
 * Clear all history
 */
export async function clearAllHistory(): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (await exists(baseDir)) {
      await remove(baseDir, { recursive: true });
      historyLog("Cleared all history");
    }
  } catch (error) {
    console.error("[History] Failed to clear all history:", error);
  }
}

/**
 * Delete all history for a specific document by its file path
 */
export async function deleteDocumentHistory(
  documentPath: string
): Promise<void> {
  try {
    const hash = await hashPath(documentPath);
    await deleteHistory(hash);
  } catch (error) {
    console.error("[History] Failed to delete document history:", error);
  }
}

/**
 * Clear history for all documents within a workspace root path.
 * Returns the number of document histories deleted.
 */
export async function clearWorkspaceHistory(
  workspaceRootPath: string
): Promise<number> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (!(await exists(baseDir))) return 0;

    const entries = await readDir(baseDir);
    let count = 0;

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      try {
        const indexPath = await join(baseDir, entry.name, INDEX_FILE);
        if (!(await exists(indexPath))) continue;

        const content = await readTextFile(indexPath);
        const index = JSON.parse(content) as HistoryIndex;

        const docPath = normalizePath(index.documentPath);
        const rootPath = normalizePath(workspaceRootPath);

        if (isWithinRoot(rootPath, docPath)) {
          await deleteHistory(entry.name);
          count++;
        }
      } catch {
        // Skip invalid entries
      }
    }

    historyLog(`Cleared workspace history: ${count} document(s)`);
    return count;
  } catch (error) {
    console.error("[History] Failed to clear workspace history:", error);
    return 0;
  }
}
