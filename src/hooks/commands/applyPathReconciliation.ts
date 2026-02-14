/**
 * Apply Path Reconciliation
 *
 * Purpose: Applies path reconciliation results to open tabs — updates file
 *   paths when files are moved/renamed, or marks documents as missing when
 *   files are deleted.
 *
 * @coordinates-with pathReconciliation.ts — pure reconciliation logic
 * @module hooks/commands/applyPathReconciliation
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
  const tabStore = useTabStore.getState();
  const docStore = useDocumentStore.getState();

  for (const result of results) {
    const targetPath = normalizePath(result.oldPath);
    if (result.action === "update_path") {
      const newPath = normalizePath(result.newPath);
      for (const windowTabs of Object.values(tabStore.tabs)) {
        for (const tab of windowTabs) {
          if (tab.filePath && normalizePath(tab.filePath) === targetPath) {
            tabStore.updateTabPath(tab.id, newPath);
            docStore.setFilePath(tab.id, newPath);
          }
        }
      }
    } else if (result.action === "mark_missing") {
      for (const windowTabs of Object.values(tabStore.tabs)) {
        for (const tab of windowTabs) {
          if (tab.filePath && normalizePath(tab.filePath) === targetPath) {
            docStore.markMissing(tab.id);
          }
        }
      }
    }
  }
}
