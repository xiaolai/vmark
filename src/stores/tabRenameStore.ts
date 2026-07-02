/**
 * tabRenameStore
 *
 * Purpose: Tracks which tab (if any) is currently in inline-rename mode. Kept
 * as a tiny standalone store so the tab context menu can start a rename and the
 * Tab pill can render its inline editor without threading state through
 * StatusBar. Only one tab renames at a time.
 *
 * @coordinates-with components/Tabs/useTabContextMenuActions.ts — starts rename
 * @coordinates-with components/Tabs/TabRenameInput.tsx — reads/clears state
 * @module stores/tabRenameStore
 */
import { create } from "zustand";

interface TabRenameState {
  /** Id of the tab currently being renamed, or null when none. */
  renamingTabId: string | null;
  /** Enter inline-rename mode for a tab. */
  startRename: (tabId: string) => void;
  /** Leave inline-rename mode (commit or cancel). */
  stopRename: () => void;
}

export const useTabRenameStore = create<TabRenameState>((set) => ({
  renamingTabId: null,
  startRename: (tabId) => set({ renamingTabId: tabId }),
  stopRename: () => set({ renamingTabId: null }),
}));
