/**
 * Tab Operations (Hooks Layer)
 *
 * Async functions for tab operations with side effects:
 * - Dialogs for confirmation prompts
 * - File system writes for saving
 * - Store mutations for closing tabs
 *
 * These functions belong in hooks layer because they have Tauri/store
 * side effects. Pure decision logic should go in utils.
 */

import { promptSaveForDirtyDocument } from "@/hooks/closeSave";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

/**
 * Close a tab with dirty check. If the document has unsaved changes,
 * prompts the user to save, don't save, or cancel.
 *
 * @returns true if tab was closed, false if user cancelled
 */
export async function closeTabWithDirtyCheck(
  windowLabel: string,
  tabId: string
): Promise<boolean> {
  const doc = useDocumentStore.getState().getDocument(tabId);
  const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);

  // Tab or document doesn't exist - treat as already closed
  if (!doc || !tab) return true;

  // If not dirty, close immediately
  if (!doc.isDirty) {
    useTabStore.getState().closeTab(windowLabel, tabId);
    useDocumentStore.getState().removeDocument(tabId);
    return true;
  }

  // Prompt user for dirty document
  const result = await promptSaveForDirtyDocument({
    windowLabel,
    tabId,
    title: doc.filePath || tab.title,
    filePath: doc.filePath,
    content: doc.content,
  });

  if (result.action === "cancelled") {
    return false;
  }

  // Either saved or discarded, proceed to close
  useTabStore.getState().closeTab(windowLabel, tabId);
  useDocumentStore.getState().removeDocument(tabId);
  return true;
}

/**
 * Close multiple tabs with dirty checks.
 * Prompts for each dirty tab. If user cancels any, stops and returns false.
 *
 * @returns true if all tabs were closed, false if user cancelled any
 */
export async function closeTabsWithDirtyCheck(
  windowLabel: string,
  tabIds: string[]
): Promise<boolean> {
  for (const tabId of tabIds) {
    const closed = await closeTabWithDirtyCheck(windowLabel, tabId);
    if (!closed) {
      return false; // User cancelled - stop closing
    }
  }
  return true;
}
