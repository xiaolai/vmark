/**
 * Active document resolution helpers
 *
 * These helpers resolve the active document for a given window label.
 * Use these instead of directly using windowLabel as a document key.
 *
 * Purpose: Prevent wrong-document bugs when menu operations act on documents.
 * The active tab's document should be used, not a document keyed by windowLabel.
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, type DocumentState } from "@/stores/documentStore";

/**
 * Get the active tab ID for a window.
 *
 * Returns the active tab's ID if it exists in the tabs array,
 * or null if:
 * - The window has no tabs
 * - No active tab is set
 * - The activeTabId references a non-existent tab
 *
 * @param windowLabel - The window label (e.g., "main")
 * @returns The active tab ID or null
 */
export function getActiveTabId(windowLabel: string): string | null {
  const { tabs, activeTabId } = useTabStore.getState();

  const windowTabs = tabs[windowLabel];
  const activeId = activeTabId[windowLabel];

  if (!windowTabs || !activeId) {
    return null;
  }

  // Verify the active tab actually exists in the tabs array
  const tabExists = windowTabs.some((tab) => tab.id === activeId);
  if (!tabExists) {
    return null;
  }

  return activeId;
}

/**
 * Get the document for the active tab in a window.
 *
 * This is the preferred way to access the current document for menu operations.
 * It properly resolves windowLabel → activeTabId → document.
 *
 * Returns null if:
 * - No active tab exists for the window
 * - The active tab has no document initialized
 *
 * @param windowLabel - The window label (e.g., "main")
 * @returns The document state or null
 */
export function getActiveDocument(windowLabel: string): DocumentState | null {
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) {
    return null;
  }

  const doc = useDocumentStore.getState().getDocument(tabId);
  return doc ?? null;
}
