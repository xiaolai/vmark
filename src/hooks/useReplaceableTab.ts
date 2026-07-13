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
import { useTabStore, tabFilePath } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { findReplaceableTab, type ReplaceableTabInfo, type TabInfo } from "@/utils/openPolicy";

// Re-exported from services/ so hook consumers keep importing it from here,
// while services/ can import the source directly (ADR-013 layering).
export { findExistingTabForPath } from "@/services/tabs/findExistingTabForPath";

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
  // Only document tabs can be replaced. A browser tab has no filePath and no
  // document entry, so mapping it into TabInfo would make a lone browser tab
  // look like a clean untitled document — and "replacing" it silently does
  // nothing (updateTabPath/loadContent are no-ops for a non-document tab).
  if (tabs.some((t) => t.kind !== "document")) return null;
  const documents = useDocumentStore.getState().documents;
  const tabsInfo: TabInfo[] = tabs.map((t) => ({
    id: t.id,
    filePath: tabFilePath(t),
    isDirty: documents[t.id]?.isDirty ?? false,
  }));
  return findReplaceableTab(tabsInfo);
}
