/**
 * Tab Store
 *
 * Purpose: Manages per-window tab lifecycle for the `DocumentTab | BrowserTab`
 *   union — create/close/pin/reorder/drag-detach, reopen history, per-doc-tab
 *   formatId, and browser tabs (create/update; helpers in tabStoreBrowser.ts).
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
 *   - Tab.formatId is computed via dispatchEditor() and recomputed in
 *     updateTabPath; kind changes fire a one-time toast (ADR-10 / WI-1A.12).
 *
 * Known limitations:
 *   - closedTabs only stores tab metadata, not document content — reopening
 *     an unsaved tab will lose edits.
 *   - No cross-window tab deduplication — the same file can be open in
 *     multiple windows.
 *
 * @coordinates-with documentStore.ts — each tab ID maps to a document entry
 * @coordinates-with workspaceStore.ts — lastOpenTabs for session restore
 * @coordinates-with lib/formats/registry.ts — dispatchEditor() drives formatId derivation
 * @coordinates-with tabRemovalBus.ts — closeTab/detachTab notify on tab removal (#1081)
 * @module stores/tabStore
 */

import { create } from "zustand";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { normalizePath } from "@/utils/paths";
import type { SplitViewMode } from "@/lib/formats/types";
import type {
  BrowserAutomationMode,
  Tab,
  DocumentTab,
} from "@/stores/tabStoreTypes";
import {
  patchBrowserTab,
} from "@/stores/tabStoreBrowser";
import { createBrowserPageAction, createBrowserTabAction } from "@/stores/tabStoreBrowserWorkspace";
import {
  deriveFormatId,
  updateTabById,
  getTabTitle,
  getLocalizedFormatName,
  applyPathUpdate,
  removeTabAt,
  insertTabForPin,
  repositionForPin,
  setActiveTabGuarded,
  generateTabId,
} from "@/stores/tabStoreHelpers";
import { notifyTabRemoved } from "@/stores/tabRemovalBus";

// Re-exported so existing `import { Tab } from "@/stores/tabStore"` keeps working (shapes live in tabStoreTypes.ts, which breaks the store↔helpers cycle).
export type { Tab, DocumentTab, BrowserTab } from "@/stores/tabStoreTypes";
export { tabFilePath } from "@/stores/tabStoreTypes";

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
  createTransferredTab: (
    windowLabel: string,
    tab: Omit<DocumentTab, "formatId" | "kind"> & { formatId?: string; kind?: "document" },
  ) => string;
  /** Create (or activate) a browser tab for `url`, deduplicated by mode. */
  createBrowserTab: (
    windowLabel: string,
    url: string,
    title?: string,
    automationMode?: BrowserAutomationMode,
  ) => string;
  /** Create a fresh browser page in the current browser workspace. */
  createBrowserPage: (
    windowLabel: string,
    url: string,
    title?: string,
    automationMode?: BrowserAutomationMode,
  ) => string;
  /** Patch browser metadata. No-op on document tabs. */
  updateBrowserTab: (
    tabId: string,
    patch: { url?: string; title?: string; scrollY?: number; generation?: number },
  ) => void;
  closeTab: (windowLabel: string, tabId: string) => void;

  // Tab state
  setActiveTab: (windowLabel: string, tabId: string | null) => void;
  setTabEditingEnabled: (tabId: string, enabled: boolean) => void;
  setTabActiveSchemaId: (tabId: string, schemaId: string | null) => void;
  setTabViewMode: (tabId: string, mode: SplitViewMode) => void;
  /** Overwrite a tab's format id, used by hot-exit restore. */
  setTabFormatId: (tabId: string, formatId: string) => void;
  updateTabPath: (tabId: string, filePath: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  togglePin: (windowLabel: string, tabId: string) => void;
  /** Re-resolve document format ids after the format registry changes. */
  recomputeAllFormatIds: () => void;

  // Detach (drag-out) — remove without adding to closedTabs
  detachTab: (windowLabel: string, tabId: string) => void;

  // Tab order
  reorderTabs: (windowLabel: string, fromIndex: number, toIndex: number) => void;

  // Session
  reopenClosedTab: (windowLabel: string) => Tab | null;
  getTabsByWindow: (windowLabel: string) => Tab[];
  getActiveTab: (windowLabel: string) => Tab | null;
  findTabByPath: (windowLabel: string, filePath: string) => Tab | null;
  findTabById: (tabId: string) => Tab | null;
  getAllOpenFilePaths: () => string[];

  // Cleanup
  removeWindow: (windowLabel: string) => void;
}

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
          (t) => t.kind === "document" && t.filePath && normalizePath(t.filePath) === normalized
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

      const newTab: DocumentTab = {
        kind: "document",
        id,
        filePath,
        title,
        isPinned: false,
        formatId: deriveFormatId(filePath),
      };
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
    const fullTab: DocumentTab = {
      ...tab,
      kind: "document",
      formatId: tab.formatId ?? deriveFormatId(tab.filePath),
    };

    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      // Dedup by id (a repeated transfer) AND by path (the file is already open
      // in the target window) — same contract as createTab, so a transfer can't
      // produce two tabs for one file in one window.
      const normalized = fullTab.filePath ? normalizePath(fullTab.filePath) : null;
      const existing = windowTabs.find(
        (t) =>
          t.id === fullTab.id ||
          (normalized !== null &&
            t.kind === "document" &&
            !!t.filePath &&
            normalizePath(t.filePath) === normalized),
      );
      if (existing) {
        returnId = existing.id;
        return { activeTabId: { ...state.activeTabId, [windowLabel]: existing.id } };
      }

      return {
        // A pinned transfer belongs in the pinned zone, not after the unpinned tabs.
        tabs: { ...state.tabs, [windowLabel]: insertTabForPin(windowTabs, fullTab) },
        activeTabId: { ...state.activeTabId, [windowLabel]: fullTab.id },
      };
    });

    return returnId;
  },

  createBrowserTab: (windowLabel, url, title, automationMode = "human") => {
    return createBrowserTabAction((updater) => set(updater), windowLabel, url, title, automationMode);
  },

  createBrowserPage: (windowLabel, url, title, automationMode = "human") => {
    return createBrowserPageAction((updater) => set(updater), windowLabel, url, title, automationMode);
  },

  updateBrowserTab: (tabId, patch) => {
    set((state) => ({ tabs: patchBrowserTab(state.tabs, tabId, patch) }));
  },

  closeTab: (windowLabel, tabId) => {
    // #1081: notify ONLY on a real removal. A pinned (refused) or unknown tab
    // removes nothing, and paneStore would collapse a split for no reason.
    let removed = false;
    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const tabIndex = windowTabs.findIndex((t) => t.id === tabId);

      if (tabIndex === -1) return state;

      const tab = windowTabs[tabIndex];

      // Don't close pinned tabs without explicit unpin
      if (tab.isPinned) {
        toast.info(i18n.t("dialog:toast.unpinBeforeClosing"));
        return state;
      }

      // Add to closed tabs for reopen
      const closed = state.closedTabs[windowLabel] || [];
      removed = true;

      return {
        ...removeTabAt(state, windowLabel, tabIndex),
        closedTabs: { ...state.closedTabs, [windowLabel]: [tab, ...closed].slice(0, 10) },
      };
    });
    // #1081: paneStore collapses a split whose pane held the tab.
    if (removed) notifyTabRemoved(windowLabel, tabId);
  },

  detachTab: (windowLabel, tabId) => {
    let removed = false;
    set((state) => {
      const windowTabs = state.tabs[windowLabel] || [];
      const tabIndex = windowTabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;
      removed = true;
      return removeTabAt(state, windowLabel, tabIndex);
    });
    // #1081: detaching removes the tab here too — collapse a split that held it.
    if (removed) notifyTabRemoved(windowLabel, tabId);
  },

  setActiveTab: (windowLabel, tabId) => {
    set((state) => setActiveTabGuarded(state, windowLabel, tabId));
  },

  /** WI-4.3 — promote a tab to read-write or revert to read-only. */
  setTabEditingEnabled: (tabId: string, enabled: boolean) => {
    set((state) => updateTabById(state, tabId, { editingEnabled: enabled }));
  },

  /** WI-1A.13 — set the active schemaRenderer id (e.g. yaml-gha-workflow).
   *  Pass `null` to clear the override and let schemaDetector decide. */
  setTabActiveSchemaId: (tabId: string, schemaId: string | null) => {
    set((state) => updateTabById(state, tabId, { activeSchemaId: schemaId }));
  },

  /** Set a tab's Source/Split/Preview view mode (split-pane formats). */
  setTabViewMode: (tabId: string, mode: SplitViewMode) => {
    set((state) => updateTabById(state, tabId, { viewMode: mode }));
  },

  /** WI-1A.13 — overwrite a tab's `formatId`. Used by hot-exit restore for
   *  untitled tabs where path-based derivation can't recover non-markdown. */
  setTabFormatId: (tabId: string, formatId: string) => {
    set((state) => updateTabById(state, tabId, { formatId }));
  },

  updateTabPath: (tabId, filePath) => {
    let formatChange: string | null = null;
    set((state) => {
      const result = applyPathUpdate(state.tabs, tabId, filePath);
      formatChange = result.formatChange;
      return { tabs: result.tabs };
    });
    /* v8 ignore next 5 -- @preserve fired only on cross-format rename; unit-tested separately */
    if (formatChange) {
      toast.info(
        i18n.t("dialog:toast.tabFormatChanged", { format: getLocalizedFormatName(formatChange) }),
      );
    }
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

      // Both directions land on the pinned/unpinned boundary, so the pinned
      // zone stays contiguous at the left of the strip.
      return {
        tabs: {
          ...state.tabs,
          [windowLabel]: repositionForPin(windowTabs, tabIndex, updatedTab),
        },
      };
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
    return (
      windowTabs.find(
        (t) => t.kind === "document" && t.filePath && normalizePath(t.filePath) === normalized,
      ) || null
    );
  },

  // Tab IDs are globally unique by construction (generateTabId uses
  // timestamp + random suffix), so scanning all windows and returning the
  // first match is safe. If invariant ever breaks, ambiguity would surface
  // as incorrect title-bar text, not as a crash.
  findTabById: (tabId) => {
    const state = get();
    for (const windowTabs of Object.values(state.tabs)) {
      const tab = windowTabs.find((t) => t.id === tabId);
      if (tab) return tab;
    }
    return null;
  },

  getAllOpenFilePaths: () => {
    const state = get();
    const paths: string[] = [];
    for (const windowTabs of Object.values(state.tabs)) {
      for (const tab of windowTabs) {
        if (tab.kind === "document" && tab.filePath) paths.push(tab.filePath);
      }
    }
    return paths;
  },

  recomputeAllFormatIds: () => {
    set((state) => {
      const newTabs: Record<string, Tab[]> = {};
      let changed = false;
      for (const windowLabel of Object.keys(state.tabs)) {
        newTabs[windowLabel] = state.tabs[windowLabel].map((t) => {
          if (t.kind !== "document") return t; // browser tabs have no formatId
          const nextFormatId = deriveFormatId(t.filePath);
          if (nextFormatId === t.formatId) return t;
          changed = true;
          return { ...t, formatId: nextFormatId };
        });
      }
      return changed ? { tabs: newTabs } : state;
    });
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
