/**
 * Find Existing Tab For Path
 *
 * Purpose: Locate an already-open tab for a given file path within a window,
 *   to prevent opening the same file twice.
 *
 * Key decisions:
 *   - Lives in services/ (not hooks/) because it reads Zustand stores via
 *     getState() but is NOT a React hook — services may be imported by both
 *     hooks/ and other services/ (ADR-013 three-tier layering).
 *
 * @module services/tabs/findExistingTabForPath
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { normalizePath } from "@/utils/paths";

/**
 * Find an existing tab for a file path in the given window.
 *
 * @param windowLabel - The window to search in
 * @param filePath - The file path to find
 * @returns Tab ID if found, null otherwise
 *
 * @example
 * const existingTabId = findExistingTabForPath(windowLabel, path);
 * if (existingTabId) {
 *   useTabStore.getState().setActiveTab(windowLabel, existingTabId);
 * }
 */
export function findExistingTabForPath(windowLabel: string, filePath: string): string | null {
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const normalizedTarget = normalizePath(filePath);

  for (const tab of tabs) {
    const doc = useDocumentStore.getState().getDocument(tab.id);
    if (doc?.filePath && normalizePath(doc.filePath) === normalizedTarget) {
      return tab.id;
    }
  }
  return null;
}
