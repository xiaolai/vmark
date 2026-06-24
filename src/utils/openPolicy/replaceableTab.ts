/**
 * Replaceable-tab detection
 *
 * Purpose: Identify the single clean untitled tab that may be replaced in place
 * instead of opening a new window when a file is opened.
 *
 * @module utils/openPolicy/replaceableTab
 */

import type { ReplaceableTabInfo, TabInfo } from "./types";

/**
 * Find a replaceable tab in the given tabs list.
 *
 * A tab is replaceable if:
 * 1. It's the only tab in the window
 * 2. It's untitled (no filePath)
 * 3. It's clean (not dirty)
 *
 * @returns ReplaceableTabInfo if found, null otherwise
 *
 * @example
 * findReplaceableTab([{ id: "tab-1", filePath: null, isDirty: false }]) // { tabId: "tab-1" }
 * findReplaceableTab([{ id: "tab-1", filePath: "/f.md", isDirty: false }]) // null
 */
export function findReplaceableTab(tabs: TabInfo[]): ReplaceableTabInfo | null {
  // Must have exactly one tab
  if (tabs.length !== 1) {
    return null;
  }

  const tab = tabs[0];

  // Must be untitled (no filePath)
  if (tab.filePath !== null) {
    return null;
  }

  // Must be clean (not dirty)
  if (tab.isDirty) {
    return null;
  }

  return { tabId: tab.id };
}
