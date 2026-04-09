/**
 * Tab Store
 *
 * Purpose: Manages per-window tab lifecycle — creation, closing, pinning,
 *   reordering, drag-detach, and recently-closed history for reopen.
 *
 * Key decisions:
 *   - State is keyed by window label to support multi-window (each window
 *     has its own independent tab list).
 *   - Pinned tabs cannot be closed without explicit unpin (user safety).
 *   - Closing a tab records it in closedTabs (max 10) for Cmd+Shift+T reopen.
 *   - Tab activation after close prefers the tab to the right, then left.
 *   - Tab IDs use timestamp + random suffix — unique but not globally sortable.
 *   - No persistence middleware: tab state is restored from workspace config
 *     on startup via workspaceStore.lastOpenTabs, not via localStorage.
 *
 * Known limitations:
 *   - closedTabs only stores tab metadata, not document content — reopening
 *     an unsaved tab will lose edits.
 *   - No cross-window tab deduplication — the same file can be open in
 *     multiple windows.
 *
 * @coordinates-with documentStore.ts — each tab ID maps to a document entry
 * @coordinates-with workspaceStore.ts — lastOpenTabs for session restore
 * @module stores/tabStore
 */

import { create } from "zustand";
import { toast } from "sonner";
import { getFileName, normalizePath } from "@/utils/paths";
import { stripMarkdownExtension } from "@/utils/dropPaths";

/** A single editor tab with ID, optional file path, display title, and pin state. */
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
  createTransferredTab: (windowLabel: string, tab: Tab) => string;
  closeTab: (windowLabel: string, tabId: string) => void;

  // Tab state
  setActiveTab: (windowLabel: string, tabId: string) => void;
  updateTabPath: (tabId: string, filePath: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  togglePin: (windowLabel: string, tabId: string) => void;

  // Detach (drag-out) — remove without adding to closedTabs
  detachTab: (windowLabel: string, tabId: string) => void;

  // Tab order
  reorderTabs: (windowLabel: string, fromIndex: number, toIndex: number) => void;

  // Session
  reopenClosedTab: (windowLabel: string) => Tab | null;
  getTabsByWindow: (windowLabel: string) => Tab[];
  getActiveTab: (windowLabel: string) => Tab | null;
  findTabByPath: (windowLabel: string, filePath: string) => Tab | null;
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

/** Manages per-window tab lifecycle — creation, closing, pinning, reordering, and reopen history. Use selectors, not destructuring. */
export const useTabStore = create<TabState & TabActions>((set, get) => ({
  tabs: {},
  activeTabId: {},
  untitledCounter: 0,
  closedTabs: {},

  createTab: (windowLabel, filePath = null) => {
    // Pre-generate ID outside set() — deterministic and side-effect-free
    const id = generateTabId();
    let returnId = id;

    set((state) => {
      // Check if file is already open in this window
      if (filePath) {
        const windowTabs = state.tabs[windowLabel] || [];
        const normalized = normalizePath(filePath);
        const existing = windowTabs.find(
          (t) => t.filePath && normalizePath(t.filePath) === normalized
        );
        if (existing) {
          returnId = existing.id;
          return { activeTabId: { ...state.activeTabId, [windowLabel]: existing.id } };
        }
      }

      let title: string;
      let newCounter = state.untitledCounter;

      if (filePath) {
        title = getTabTitle(filePath);
      } else {
        newCounter = state.untitledCounter + 1;
        title = getTabTitle(null, newCounter);
      }

      const newTab: Tab = { id, filePath, title, isPinned: false };
      const windowTabs = state.tabs[windowLabel] || [];

      return {
        tabs: { ...state.tabs, [windowLabel]: [...windowTabs, newTab] },
        activeTabId: { ...state.activeTabId, [windowLabel]: id },
        untitledCounter: newCounter,
      };
    });

    return returnId;
  },

  createTransferredTab: (windowLabel, tab) => {
    let returnId = tab.id;

    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const existing = windowTabs.find((t) => t.id === tab.id);
      if (existing) {
        returnId = existing.id;
        return { activeTabId: { ...state.activeTabId, [windowLabel]: existing.id } };
      }

      return {
        tabs: { ...state.tabs, [windowLabel]: [...windowTabs, tab] },
        activeTabId: { ...state.activeTabId, [windowLabel]: tab.id },
      };
    });

    return returnId;
  },

  closeTab: (windowLabel, tabId) => {
    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const tabIndex = windowTabs.findIndex((t) => t.id === tabId);

      if (tabIndex === -1) return state;

      const tab = windowTabs[tabIndex];

      // Don't close pinned tabs without explicit unpin
      if (tab.isPinned) {
        toast.info("Unpin tab before closing");
        return state;
      }

      // Add to closed tabs for reopen
      const closed = state.closedTabs[windowLabel] || [];
      const newClosed = [tab, ...closed].slice(0, 10);

      const newTabs = windowTabs.filter((t) => t.id !== tabId);

      // Determine new active tab
      let newActiveId = state.activeTabId[windowLabel];
      if (newActiveId === tabId) {
        if (newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          newActiveId = newTabs[newIndex].id;
        } else {
          newActiveId = null;
        }
      }

      return {
        tabs: { ...state.tabs, [windowLabel]: newTabs },
        activeTabId: { ...state.activeTabId, [windowLabel]: newActiveId },
        closedTabs: { ...state.closedTabs, [windowLabel]: newClosed },
      };
    });
  },

  detachTab: (windowLabel, tabId) => {
    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const tabIndex = windowTabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;

      const newTabs = windowTabs.filter((t) => t.id !== tabId);

      let newActiveId = state.activeTabId[windowLabel];
      if (newActiveId === tabId) {
        if (newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          newActiveId = newTabs[newIndex].id;
        } else {
          newActiveId = null;
        }
      }

      return {
        tabs: { ...state.tabs, [windowLabel]: newTabs },
        activeTabId: { ...state.activeTabId, [windowLabel]: newActiveId },
      };
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

  reopenClosedTab: (windowLabel) => {
    let reopened: Tab | null = null;

    set((state) => {
      const closed = state.closedTabs[windowLabel] || [];
      if (closed.length === 0) return state;

      const [tab, ...rest] = closed;
      reopened = tab;
      const windowTabs = state.tabs[windowLabel] || [];

      return {
        tabs: { ...state.tabs, [windowLabel]: [...windowTabs, tab] },
        activeTabId: { ...state.activeTabId, [windowLabel]: tab.id },
        closedTabs: { ...state.closedTabs, [windowLabel]: rest },
      };
    });

    return reopened;
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
    const normalized = normalizePath(filePath);
    return windowTabs.find((t) => t.filePath && normalizePath(t.filePath) === normalized) || null;
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
