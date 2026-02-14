/**
 * Replaceable Tab Helpers
 *
 * Purpose: Helpers for finding an empty untitled tab to reuse when opening
 *   a file — avoids creating unnecessary new tabs.
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it accesses Zustand stores
 *   - A tab is replaceable if it's the only tab, untitled, and clean
 *   - findExistingTabForPath checks if a file is already open (prevents duplicates)
 *
 * @coordinates-with useFileOperations.ts — uses getReplaceableTab on file open
 * @module hooks/useReplaceableTab
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { findReplaceableTab, type ReplaceableTabInfo, type TabInfo } from "@/utils/openPolicy";
import { normalizePath } from "@/utils/paths";

/**
 * Get a replaceable tab for a window if one exists.
 *
 * A tab is replaceable if it's the only tab, is untitled (no filePath),
 * and is clean (not dirty). This is used to replace a fresh untitled tab
 * when opening a file, instead of spawning a new window.
 *
 * @param windowLabel - The window to check for a replaceable tab
 * @returns ReplaceableTabInfo if found, null otherwise
 *
 * @example
 * const replaceableTab = getReplaceableTab(windowLabel);
 * const decision = resolveOpenAction({ ..., replaceableTab });
 */
export function getReplaceableTab(windowLabel: string): ReplaceableTabInfo | null {
  const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
  const documents = useDocumentStore.getState().documents;
  const tabsInfo: TabInfo[] = tabs.map((t) => ({
    id: t.id,
    filePath: t.filePath,
    isDirty: documents[t.id]?.isDirty ?? false,
  }));
  return findReplaceableTab(tabsInfo);
}

/**
 * Find an existing tab for a file path in the current window.
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
