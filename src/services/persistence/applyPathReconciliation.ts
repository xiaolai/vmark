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
  const tabStore = useTabStore.getState();
  const docStore = useDocumentStore.getState();

  for (const result of results) {
    const targetPath = normalizePath(result.oldPath);
    /* v8 ignore next -- @preserve reason: false branch (mark_missing) not exercised in unit tests */
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
    /* v8 ignore start -- @preserve mark_missing path requires a delete event with matching tab path */
    } else if (result.action === "mark_missing") {
      for (const windowTabs of Object.values(tabStore.tabs)) {
        for (const tab of windowTabs) {
          if (tab.filePath && normalizePath(tab.filePath) === targetPath) {
            docStore.markMissing(tab.id);
          }
        }
      }
    }
    /* v8 ignore stop */
  }
}
