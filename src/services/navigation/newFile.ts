/**
 * Utility for creating new untitled files.
 *
 * Untitled tabs are always markdown: `tabStore.createTab` derives the format
 * from the (null) file path. The optional `formatId` override this once took
 * was plumbing for a "New Other Format" menu item that was never built.
 * A non-markdown untitled tab still exists
 * — hot-exit restore re-applies the persisted format_id through
 * `setTabFormatId`, because the path cannot recover it.
 *
 * @module services/navigation/newFile
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { claimTabForWorkspaceContext } from "@/services/workspaces/workspaceContextOwnership";

/**
 * Create a new untitled markdown tab with an empty document.
 *
 * @param windowLabel - The window label where the tab should be created.
 * @returns The ID of the newly created tab.
 */
export function createUntitledTab(windowLabel: string): string {
  const tabId = useTabStore.getState().createTab(windowLabel, null);
  initUntitledDocument(tabId);
  claimTabForWorkspaceContext(windowLabel, tabId, null);
  return tabId;
}

/**
 * Give an existing untitled tab its empty document — the one shape every
 * untitled document starts in, whether the tab is new or reopened.
 */
export function initUntitledDocument(tabId: string): void {
  useDocumentStore.getState().initDocument(tabId, "", null);
}
