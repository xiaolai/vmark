/**
 * MCP Bridge - Tab Management Handlers
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { respond } from "./utils";

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
    const windowId = (args.windowId as string) ?? "main";
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
 * Handle tabs.getActive request.
 * Gets the currently active tab in the window.
 */
export async function handleTabsGetActive(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = (args.windowId as string) ?? "main";
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
 * Handle tabs.switch request.
 * Switches to a specific tab by ID.
 */
export async function handleTabsSwitch(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const tabId = args.tabId as string;
    const windowId = (args.windowId as string) ?? "main";

    if (!tabId) {
      throw new Error("tabId is required");
    }

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
    const tabId = args.tabId as string | undefined;
    const windowId = (args.windowId as string) ?? "main";
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
    const windowId = (args.windowId as string) ?? "main";
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
 * Handle tabs.getInfo request.
 * Gets detailed information about a specific tab.
 */
export async function handleTabsGetInfo(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const tabId = args.tabId as string | undefined;
    const windowId = (args.windowId as string) ?? "main";
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
