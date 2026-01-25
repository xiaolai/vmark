import { create } from "zustand";
import { toast } from "sonner";
import { getFileName } from "@/utils/paths";
import { stripMarkdownExtension } from "@/utils/dropPaths";

// Tab representation
export interface Tab {
  id: string;
  filePath: string | null; // null = untitled
  title: string;
  isPinned: boolean;
}

// Per-window tab state
interface TabState {
  // Tabs keyed by window label
  tabs: Record<string, Tab[]>;
  // Active tab ID per window
  activeTabId: Record<string, string | null>;
  // Counter for untitled tabs
  untitledCounter: number;
  // Recently closed tabs for reopen (per window, max 10)
  closedTabs: Record<string, Tab[]>;
}

interface TabActions {
  // Tab CRUD
  createTab: (windowLabel: string, filePath?: string | null) => string;
  closeTab: (windowLabel: string, tabId: string) => void;
  closeOtherTabs: (windowLabel: string, tabId: string) => void;
  closeTabsToRight: (windowLabel: string, tabId: string) => void;
  closeAllTabs: (windowLabel: string) => void;

  // Tab state
  setActiveTab: (windowLabel: string, tabId: string) => void;
  updateTabPath: (tabId: string, filePath: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  togglePin: (windowLabel: string, tabId: string) => void;

  // Tab order
  reorderTabs: (windowLabel: string, fromIndex: number, toIndex: number) => void;
  moveTabToIndex: (windowLabel: string, tabId: string, toIndex: number) => void;

  // Session
  reopenClosedTab: (windowLabel: string) => Tab | null;
  getTabsByWindow: (windowLabel: string) => Tab[];
  getActiveTab: (windowLabel: string) => Tab | null;
  findTabByPath: (windowLabel: string, filePath: string) => Tab | null;
  findTabByFilePath: (filePath: string) => { tab: Tab; windowLabel: string } | null;
  getAllOpenFilePaths: () => string[];

  // Cleanup
  removeWindow: (windowLabel: string) => void;
}

// Generate unique tab ID
const generateTabId = (): string => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Get filename from path for tab title
const getTabTitle = (filePath: string | null, untitledNum?: number): string => {
  if (!filePath) {
    return untitledNum ? `Untitled-${untitledNum}` : "Untitled";
  }
  // Extract filename without markdown extension
  const name = getFileName(filePath) || filePath;
  return stripMarkdownExtension(name);
};

export const useTabStore = create<TabState & TabActions>((set, get) => ({
  tabs: {},
  activeTabId: {},
  untitledCounter: 0,
  closedTabs: {},

  createTab: (windowLabel, filePath = null) => {
    const state = get();

    // Check if file is already open in this window
    if (filePath) {
      const existing = state.findTabByPath(windowLabel, filePath);
      if (existing) {
        // Activate existing tab instead of creating new
        set({ activeTabId: { ...state.activeTabId, [windowLabel]: existing.id } });
        return existing.id;
      }
    }

    const id = generateTabId();
    let title: string;
    let newCounter = state.untitledCounter;

    if (filePath) {
      title = getTabTitle(filePath);
    } else {
      newCounter = state.untitledCounter + 1;
      title = getTabTitle(null, newCounter);
    }

    const newTab: Tab = {
      id,
      filePath,
      title,
      isPinned: false,
    };

    const windowTabs = state.tabs[windowLabel] || [];

    set({
      tabs: { ...state.tabs, [windowLabel]: [...windowTabs, newTab] },
      activeTabId: { ...state.activeTabId, [windowLabel]: id },
      untitledCounter: newCounter,
    });

    return id;
  },

  closeTab: (windowLabel, tabId) => {
    const state = get();
    const windowTabs = state.tabs[windowLabel] || [];
    const tabIndex = windowTabs.findIndex((t) => t.id === tabId);

    if (tabIndex === -1) return;

    const tab = windowTabs[tabIndex];

    // Don't close pinned tabs without explicit unpin
    if (tab.isPinned) {
      toast.info("Unpin tab before closing");
      return;
    }

    // Add to closed tabs for reopen
    const closed = state.closedTabs[windowLabel] || [];
    const newClosed = [tab, ...closed].slice(0, 10); // Keep max 10

    const newTabs = windowTabs.filter((t) => t.id !== tabId);

    // Determine new active tab
    let newActiveId = state.activeTabId[windowLabel];
    if (newActiveId === tabId) {
      if (newTabs.length > 0) {
        // Activate adjacent tab (prefer right, then left)
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        newActiveId = newTabs[newIndex].id;
      } else {
        newActiveId = null;
      }
    }

    set({
      tabs: { ...state.tabs, [windowLabel]: newTabs },
      activeTabId: { ...state.activeTabId, [windowLabel]: newActiveId },
      closedTabs: { ...state.closedTabs, [windowLabel]: newClosed },
    });
  },

  closeOtherTabs: (windowLabel, tabId) => {
    const state = get();
    const windowTabs = state.tabs[windowLabel] || [];

    // Keep only the specified tab and pinned tabs
    const keptTabs = windowTabs.filter((t) => t.id === tabId || t.isPinned);
    const closedOnes = windowTabs.filter((t) => t.id !== tabId && !t.isPinned);

    // Add closed tabs to history
    const closed = state.closedTabs[windowLabel] || [];
    const newClosed = [...closedOnes, ...closed].slice(0, 10);

    set({
      tabs: { ...state.tabs, [windowLabel]: keptTabs },
      activeTabId: { ...state.activeTabId, [windowLabel]: tabId },
      closedTabs: { ...state.closedTabs, [windowLabel]: newClosed },
    });
  },

  closeTabsToRight: (windowLabel, tabId) => {
    const state = get();
    const windowTabs = state.tabs[windowLabel] || [];
    const tabIndex = windowTabs.findIndex((t) => t.id === tabId);

    if (tabIndex === -1) return;

    // Keep tabs up to and including the specified tab, plus pinned tabs after
    const keptTabs = windowTabs.filter((t, i) => i <= tabIndex || t.isPinned);
    const closedOnes = windowTabs.filter((t, i) => i > tabIndex && !t.isPinned);

    const closed = state.closedTabs[windowLabel] || [];
    const newClosed = [...closedOnes, ...closed].slice(0, 10);

    // If active tab was closed, activate the rightmost kept tab
    let newActiveId = state.activeTabId[windowLabel];
    if (newActiveId && !keptTabs.find((t) => t.id === newActiveId)) {
      newActiveId = keptTabs[keptTabs.length - 1]?.id || null;
    }

    set({
      tabs: { ...state.tabs, [windowLabel]: keptTabs },
      activeTabId: { ...state.activeTabId, [windowLabel]: newActiveId },
      closedTabs: { ...state.closedTabs, [windowLabel]: newClosed },
    });
  },

  closeAllTabs: (windowLabel) => {
    const state = get();
    const windowTabs = state.tabs[windowLabel] || [];

    // Keep only pinned tabs
    const keptTabs = windowTabs.filter((t) => t.isPinned);
    const closedOnes = windowTabs.filter((t) => !t.isPinned);

    const closed = state.closedTabs[windowLabel] || [];
    const newClosed = [...closedOnes, ...closed].slice(0, 10);

    const newActiveId = keptTabs.length > 0 ? keptTabs[0].id : null;

    set({
      tabs: { ...state.tabs, [windowLabel]: keptTabs },
      activeTabId: { ...state.activeTabId, [windowLabel]: newActiveId },
      closedTabs: { ...state.closedTabs, [windowLabel]: newClosed },
    });
  },

  setActiveTab: (windowLabel, tabId) => {
    set((state) => ({
      activeTabId: { ...state.activeTabId, [windowLabel]: tabId },
    }));
  },

  updateTabPath: (tabId, filePath) => {
    set((state) => {
      const newTabs = { ...state.tabs };
      for (const windowLabel of Object.keys(newTabs)) {
        newTabs[windowLabel] = newTabs[windowLabel].map((t) =>
          t.id === tabId ? { ...t, filePath, title: getTabTitle(filePath) } : t
        );
      }
      return { tabs: newTabs };
    });
  },

  updateTabTitle: (tabId, title) => {
    set((state) => {
      const newTabs = { ...state.tabs };
      for (const windowLabel of Object.keys(newTabs)) {
        newTabs[windowLabel] = newTabs[windowLabel].map((t) =>
          t.id === tabId ? { ...t, title } : t
        );
      }
      return { tabs: newTabs };
    });
  },

  togglePin: (windowLabel, tabId) => {
    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const tabIndex = windowTabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;

      const tab = windowTabs[tabIndex];
      const updatedTab = { ...tab, isPinned: !tab.isPinned };

      // Move pinned tabs to the left
      let newTabs: Tab[];
      if (updatedTab.isPinned) {
        // Find insertion point (after last pinned tab)
        const lastPinnedIndex = windowTabs.reduce(
          (last, t, i) => (t.isPinned ? i : last),
          -1
        );
        newTabs = [...windowTabs];
        newTabs.splice(tabIndex, 1);
        newTabs.splice(lastPinnedIndex + 1, 0, updatedTab);
      } else {
        // Just update in place
        newTabs = windowTabs.map((t) => (t.id === tabId ? updatedTab : t));
      }

      return { tabs: { ...state.tabs, [windowLabel]: newTabs } };
    });
  },

  reorderTabs: (windowLabel, fromIndex, toIndex) => {
    set((state) => {
      const windowTabs = [...(state.tabs[windowLabel] || [])];
      if (fromIndex < 0 || fromIndex >= windowTabs.length) return state;
      if (toIndex < 0 || toIndex >= windowTabs.length) return state;

      const [moved] = windowTabs.splice(fromIndex, 1);
      windowTabs.splice(toIndex, 0, moved);

      return { tabs: { ...state.tabs, [windowLabel]: windowTabs } };
    });
  },

  moveTabToIndex: (windowLabel, tabId, toIndex) => {
    const state = get();
    const windowTabs = state.tabs[windowLabel] || [];
    const fromIndex = windowTabs.findIndex((t) => t.id === tabId);
    if (fromIndex !== -1) {
      state.reorderTabs(windowLabel, fromIndex, toIndex);
    }
  },

  reopenClosedTab: (windowLabel) => {
    const state = get();
    const closed = state.closedTabs[windowLabel] || [];
    if (closed.length === 0) return null;

    const [tab, ...rest] = closed;
    const windowTabs = state.tabs[windowLabel] || [];

    set({
      tabs: { ...state.tabs, [windowLabel]: [...windowTabs, tab] },
      activeTabId: { ...state.activeTabId, [windowLabel]: tab.id },
      closedTabs: { ...state.closedTabs, [windowLabel]: rest },
    });

    return tab;
  },

  getTabsByWindow: (windowLabel) => {
    return get().tabs[windowLabel] || [];
  },

  getActiveTab: (windowLabel) => {
    const state = get();
    const activeId = state.activeTabId[windowLabel];
    if (!activeId) return null;
    const windowTabs = state.tabs[windowLabel] || [];
    return windowTabs.find((t) => t.id === activeId) || null;
  },

  findTabByPath: (windowLabel, filePath) => {
    const windowTabs = get().tabs[windowLabel] || [];
    return windowTabs.find((t) => t.filePath === filePath) || null;
  },

  findTabByFilePath: (filePath) => {
    const state = get();
    for (const [windowLabel, windowTabs] of Object.entries(state.tabs)) {
      const tab = windowTabs.find((t) => t.filePath === filePath);
      if (tab) return { tab, windowLabel };
    }
    return null;
  },

  getAllOpenFilePaths: () => {
    const state = get();
    const paths: string[] = [];
    for (const windowTabs of Object.values(state.tabs)) {
      for (const tab of windowTabs) {
        if (tab.filePath) paths.push(tab.filePath);
      }
    }
    return paths;
  },

  removeWindow: (windowLabel) => {
    set((state) => {
      const { [windowLabel]: _tabs, ...restTabs } = state.tabs;
      const { [windowLabel]: _activeId, ...restActiveId } = state.activeTabId;
      const { [windowLabel]: _closed, ...restClosed } = state.closedTabs;
      return {
        tabs: restTabs,
        activeTabId: restActiveId,
        closedTabs: restClosed,
      };
    });
  },
}));
