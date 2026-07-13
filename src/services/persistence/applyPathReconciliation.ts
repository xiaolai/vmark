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
 * For update_path: Updates both tab path and document filePath.
 * For mark_missing: Sets isMissing flag on document.
 *
 * @param results - Results from reconcilePathChange
 */
export function applyPathReconciliation(results: ReconcileResult[]): void {
  for (const result of results) {
    const tabIds = documentTabIdsAtPath(result.oldPath);
    if (result.action === "update_path") {
      const newPath = normalizePath(result.newPath);
      for (const tabId of tabIds) {
        useTabStore.getState().updateTabPath(tabId, newPath);
        useDocumentStore.getState().setFilePath(tabId, newPath);
      }
    } else {
      for (const tabId of tabIds) {
        useDocumentStore.getState().markMissing(tabId);
      }
    }
  }
}

/**
 * The ids of every open document tab (across all windows) whose file path is
 * `path`. Read fresh per result: `updateTabPath` replaces tab objects, so a
 * snapshot taken before the loop would go stale after the first update.
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
