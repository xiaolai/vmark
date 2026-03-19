/**
 * MCP Bridge — Tab Management Handlers
 *
 * Purpose: Tab operations via MCP — list tabs, switch active tab, create
 *   new tab, and close tab with dirty check.
 *
 * @coordinates-with tabStore.ts — tab CRUD operations
 * @module hooks/mcpBridge/tabHandlers
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { respond, resolveWindowId } from "./utils";
import { requireString, optionalString } from "./validateArgs";

/**
 * Tab information for MCP responses.
 */
interface TabInfo {
  id: string;
  title: string;
  filePath: string | null;
  isDirty: boolean;
  isActive: boolean;
}

/**
 * Handle tabs.list request.
 * Lists all tabs in the specified window.
 */
export async function handleTabsList(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    const tabs = tabStore.tabs[windowId] ?? [];
    const activeTabId = tabStore.activeTabId[windowId];

    const tabInfos: TabInfo[] = tabs.map((tab) => {
      const doc = docStore.getDocument(tab.id);
      return {
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        isDirty: doc?.isDirty ?? false,
        isActive: tab.id === activeTabId,
      };
    });

    await respond({ id, success: true, data: tabInfos });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.switch request.
 * Switches to a specific tab by ID.
 */
export async function handleTabsSwitch(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const tabId = requireString(args, "tabId");
    const windowId = resolveWindowId(optionalString(args, "windowId"));

    const tabStore = useTabStore.getState();
    const tabs = tabStore.tabs[windowId] ?? [];
    const tabExists = tabs.some((t) => t.id === tabId);

    if (!tabExists) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    tabStore.setActiveTab(windowId, tabId);

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.close request.
 * Closes a specific tab or the active tab.
 */
export async function handleTabsClose(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const tabId = optionalString(args, "tabId");
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();

    const targetTabId = tabId ?? tabStore.activeTabId[windowId];
    if (!targetTabId) {
      throw new Error("No tab to close");
    }

    tabStore.closeTab(windowId, targetTabId);

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.create request.
 * Creates a new empty tab.
 */
export async function handleTabsCreate(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    const tabId = tabStore.createTab(windowId, null);
    docStore.initDocument(tabId, "", null);

    await respond({ id, success: true, data: { tabId } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.getActive request.
 * Returns information about the active tab in the specified window.
 */
export async function handleTabsGetActive(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    const activeTabId = tabStore.activeTabId[windowId];
    if (!activeTabId) {
      await respond({ id, success: true, data: null });
      return;
    }

    const tabs = tabStore.tabs[windowId] ?? [];
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) {
      await respond({ id, success: true, data: null });
      return;
    }

    const doc = docStore.getDocument(tab.id);

    const tabInfo: TabInfo = {
      id: tab.id,
      title: tab.title,
      filePath: tab.filePath,
      isDirty: doc?.isDirty ?? false,
      isActive: true,
    };

    await respond({ id, success: true, data: tabInfo });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.getInfo request.
 * Gets detailed information about a specific tab.
 */
export async function handleTabsGetInfo(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const tabId = optionalString(args, "tabId");
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    const targetTabId = tabId ?? tabStore.activeTabId[windowId];
    if (!targetTabId) {
      throw new Error("No tab specified and no active tab");
    }

    const tabs = tabStore.tabs[windowId] ?? [];
    const tab = tabs.find((t) => t.id === targetTabId);
    if (!tab) {
      throw new Error(`Tab not found: ${targetTabId}`);
    }

    const doc = docStore.getDocument(tab.id);
    const activeTabId = tabStore.activeTabId[windowId];

    const tabInfo: TabInfo = {
      id: tab.id,
      title: tab.title,
      filePath: tab.filePath,
      isDirty: doc?.isDirty ?? false,
      isActive: tab.id === activeTabId,
    };

    await respond({ id, success: true, data: tabInfo });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle tabs.reopenClosed request.
 * Reopens the most recently closed tab.
 */
export async function handleTabsReopenClosed(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(optionalString(args, "windowId"));
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    // Reopen the most recently closed tab
    const reopenedTab = tabStore.reopenClosedTab(windowId);

    if (!reopenedTab) {
      await respond({
        id,
        success: true,
        data: null, // No closed tabs to reopen
      });
      return;
    }

    // Initialize document for reopened tab
    if (reopenedTab.filePath) {
      // Load content from file
      try {
        const content = await readTextFile(reopenedTab.filePath);
        docStore.initDocument(reopenedTab.id, content, reopenedTab.filePath);
      } catch {
        // File may have been deleted, init with empty content
        docStore.initDocument(reopenedTab.id, "", reopenedTab.filePath);
      }
    } else {
      // Untitled tab - init with empty content
      docStore.initDocument(reopenedTab.id, "", null);
    }

    await respond({
      id,
      success: true,
      data: {
        tabId: reopenedTab.id,
        filePath: reopenedTab.filePath,
        title: reopenedTab.title,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
