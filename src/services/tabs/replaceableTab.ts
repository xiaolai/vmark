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
 *   - `isWindowEmpty` is the ZERO-tab sibling: no tab to replace, but nothing
 *     to preserve either. Both feed the same `resolveOpenAction` context.
 *
 * @coordinates-with useFileOperations.ts — uses getReplaceableTab on file open
 * @module services/tabs/replaceableTab
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

/**
 * Whether a window has no tabs at all — the Welcome screen state (#1331).
 *
 * Distinct from "has a replaceable tab": there is no tab id to replace, so
 * `getReplaceableTab` correctly returns null and the caller would otherwise
 * route the file to a NEW window, leaving the window the user acted in empty.
 *
 * Counts every tab kind. A lone browser tab is not a document and cannot be
 * replaced, but the window is not empty either — closing the browser to make
 * room for a file is not something an open should decide.
 *
 * @param windowLabel - The window to check
 * @returns true when the window holds no tabs
 */
export function isWindowEmpty(windowLabel: string): boolean {
  return (useTabStore.getState().tabs[windowLabel] ?? []).length === 0;
}
