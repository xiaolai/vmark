/**
 * Apply Path Reconciliation
 *
 * Purpose: Applies path reconciliation results to open tabs — updates file
 *   paths when files are moved/renamed, or marks documents as missing when
 *   files are deleted. Mutates stores, so it lives in the services tier
 *   (ADR-013), not hooks — it is a plain function, not a React hook.
 *
 * @coordinates-with utils/pathReconciliation.ts — pure reconciliation logic
 * @coordinates-with services/persistence/renameFile.ts — rename caller
 * @module services/persistence/applyPathReconciliation
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { ReconcileResult } from "@/utils/pathReconciliation";
import { normalizePath } from "@/utils/paths";

/**
 * Apply reconciliation results to update open tabs and documents.
 *
 * For update_path: updates tab path + document filePath, and clears any stale
 *   `isMissing` flag (a re-pointed file is present again; leaving it missing
 *   keeps autosave disabled and the missing-file UI on a live file).
 * For mark_missing: sets the isMissing flag on the document.
 *
 * Tab ids are resolved by old path ONCE, before any mutation. Resolving per
 * result would make the batch order-dependent: after an a→b update, a later
 * b→c result would re-collect the just-moved a-tab and move it again, so a
 * chain `[a→b, b→c]` (or a swap) collapses multiple tabs onto one file — a
 * later save then writes to the wrong path.
 *
 * @param results - Results from reconcilePathChange
 */
export function applyPathReconciliation(results: ReconcileResult[]): void {
  const tabIdsByOldPath = snapshotTabIdsByOldPath(results);

  for (const result of results) {
    const tabIds = tabIdsByOldPath.get(normalizePath(result.oldPath)) ?? [];
    if (result.action === "update_path") {
      const newPath = normalizePath(result.newPath);
      for (const tabId of tabIds) {
        useTabStore.getState().updateTabPath(tabId, newPath);
        useDocumentStore.getState().setFilePath(tabId, newPath);
        useDocumentStore.getState().clearMissing(tabId);
      }
    } else {
      for (const tabId of tabIds) {
        useDocumentStore.getState().markMissing(tabId);
      }
    }
  }
}

/**
 * Freeze which open document tabs sit at each affected old path, evaluated
 * against current tab state before any mutation runs.
 */
function snapshotTabIdsByOldPath(results: ReconcileResult[]): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const result of results) {
    const key = normalizePath(result.oldPath);
    if (!byPath.has(key)) byPath.set(key, documentTabIdsAtPath(key));
  }
  return byPath;
}

/**
 * The ids of every open document tab (across all windows) whose file path is
 * `path`.
 */
function documentTabIdsAtPath(path: string): string[] {
  const targetPath = normalizePath(path);
  const ids: string[] = [];
  for (const windowTabs of Object.values(useTabStore.getState().tabs)) {
    for (const tab of windowTabs) {
      if (tab.kind === "document" && tab.filePath && normalizePath(tab.filePath) === targetPath) {
        ids.push(tab.id);
      }
    }
  }
  return ids;
}
