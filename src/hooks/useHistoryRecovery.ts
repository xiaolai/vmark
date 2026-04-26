/**
 * History Recovery (Hooks Layer)
 *
 * Purpose: Bulk-clearing operations for document history —
 *   deletes history per-document or per-workspace, or permanently clears all history.
 *
 * Key decisions:
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
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { historyLog, historyError } from "@/utils/debug";
import {
  INDEX_FILE,
  hashPath,
  parseHistoryIndex,
} from "@/utils/historyTypes";
import { normalizePath, isWithinRoot } from "@/utils/paths/paths";
import { getHistoryBaseDir } from "@/hooks/useHistoryOperations";

/**
 * Permanently delete history for a document.
 * Surfaces success/failure to the user — these are explicit user actions
 * from Settings, so silent failure was misleading.
 */
export async function deleteHistory(pathHash: string): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    const historyDir = await join(baseDir, pathHash);

    if (await exists(historyDir)) {
      await remove(historyDir, { recursive: true });
      historyLog("Deleted history for:", pathHash);
    }
    toast.success(i18n.t("dialog:toast.historyDeleted"));
  } catch (error) {
    historyError("Failed to delete history:", error);
    toast.error(i18n.t("dialog:toast.historyDeleteFailed"));
  }
}

/** Clear all history */
export async function clearAllHistory(): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (await exists(baseDir)) {
      await remove(baseDir, { recursive: true });
      historyLog("Cleared all history");
    }
    toast.success(i18n.t("dialog:toast.historyClearedAll"));
  } catch (error) {
    historyError("Failed to clear all history:", error);
    toast.error(i18n.t("dialog:toast.historyClearAllFailed"));
  }
}

/** Delete all history for a specific document by its file path. */
export async function deleteDocumentHistory(
  documentPath: string
): Promise<void> {
  try {
    const hash = await hashPath(documentPath);
    await deleteHistory(hash);
  } catch (error) {
    historyError("Failed to delete document history:", error);
    toast.error(i18n.t("dialog:toast.historyDeleteFailed"));
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
    if (!workspaceRootPath.trim()) return 0;

    const baseDir = await getHistoryBaseDir();
    if (!(await exists(baseDir))) return 0;

    const entries = await readDir(baseDir);
    let count = 0;
    let failedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      try {
        const indexPath = await join(baseDir, entry.name, INDEX_FILE);
        if (!(await exists(indexPath))) continue;

        const content = await readTextFile(indexPath);
        const index = parseHistoryIndex(JSON.parse(content));
        if (!index) continue;

        const docPath = normalizePath(index.documentPath);
        const rootPath = normalizePath(workspaceRootPath);

        if (isWithinRoot(rootPath, docPath)) {
          // Inline the removal so each file doesn't fire its own toast
          // (deleteHistory toasts on success/failure). Wrap remove in its
          // own try so a single bad file doesn't abort the batch — the
          // outer summary toast below still surfaces failures.
          const historyDir = await join(baseDir, entry.name);
          try {
            if (await exists(historyDir)) {
              await remove(historyDir, { recursive: true });
            }
            // Only count entries we actually removed (or that were already
            // gone). Failed removes do not contribute to the success count.
            count++;
          } catch (e) {
            failedCount++;
            historyError("Failed to remove history dir:", entry.name, e);
          }
        }
      } catch {
        // Skip invalid entries
      }
    }

    historyLog(
      `Cleared workspace history: ${count} document(s) succeeded, ${failedCount} failed`,
    );
    if (count > 0) {
      toast.success(
        i18n.t("dialog:toast.historyClearedWorkspace", { count }),
      );
    }
    if (failedCount > 0) {
      // Surface the partial failure so the user knows not everything was
      // cleared (e.g., permission errors on a subset).
      toast.warning(i18n.t("dialog:toast.historyClearWorkspaceFailed"));
    }
    return count;
  } catch (error) {
    historyError("Failed to clear workspace history:", error);
    toast.error(i18n.t("dialog:toast.historyClearWorkspaceFailed"));
    return 0;
  }
}
