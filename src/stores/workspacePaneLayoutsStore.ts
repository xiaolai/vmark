/**
 * Per-instance pane-layout snapshots (WI-10.2 / plan D3).
 *
 * Purpose: hold the split layouts of HIDDEN workspace instances while the
 * active instance's layout lives in `paneStore.byWindow`. The rail-switch
 * coordinator stashes the outgoing instance's split here and restores the
 * incoming one through `paneStore.replaceWindowSplit` (WI-10.1) — the only
 * writer of the final activeTabId alias.
 *
 * A stash holding a tab that closes while hidden is pruned immediately (bus
 * subscription); restore-time validation in replaceWindowSplit remains the
 * defense-in-depth layer.
 *
 * @coordinates-with stores/paneStore.ts — WindowSplit shape + atomic restore
 * @coordinates-with services/workspaces/switchWorkspaceInstance.ts — stash/restore
 * @coordinates-with stores/tabRemovalBus.ts — hidden-pane-tab pruning
 * @module stores/workspacePaneLayoutsStore
 */
import { create } from "zustand";
import type { WindowSplit } from "./paneStore";
import { onTabRemoved } from "./tabRemovalBus";

interface WorkspacePaneLayoutsState {
  layoutsByInstance: Record<string, WindowSplit>;
  getPaneLayout: (instanceId: string) => WindowSplit | null;
  /** Stash a split; a disabled split stores nothing (nothing to restore). */
  stashPaneLayout: (instanceId: string, split: WindowSplit) => void;
  copyPaneLayout: (fromId: string, toId: string) => void;
  rekeyPaneLayout: (oldId: string, newId: string) => void;
  removePaneLayout: (instanceId: string) => void;
  /** Null out a closed tab in every stash; drop stashes with no live pane. */
  prunePaneTab: (tabId: string) => void;
  resetPaneLayouts: () => void;
}

export const useWorkspacePaneLayoutsStore = create<WorkspacePaneLayoutsState>()(
  (set, get) => ({
    layoutsByInstance: {},

    getPaneLayout: (instanceId) => get().layoutsByInstance[instanceId] ?? null,

    stashPaneLayout: (instanceId, split) =>
      set((state) => {
        if (!split.enabled) {
          if (!(instanceId in state.layoutsByInstance)) return {};
          const { [instanceId]: _removed, ...rest } = state.layoutsByInstance;
          return { layoutsByInstance: rest };
        }
        return {
          layoutsByInstance: { ...state.layoutsByInstance, [instanceId]: { ...split } },
        };
      }),

    copyPaneLayout: (fromId, toId) =>
      set((state) => {
        const source = state.layoutsByInstance[fromId];
        if (!source) return {};
        return { layoutsByInstance: { ...state.layoutsByInstance, [toId]: { ...source } } };
      }),

    rekeyPaneLayout: (oldId, newId) =>
      set((state) => {
        const source = state.layoutsByInstance[oldId];
        if (!source) return {};
        const { [oldId]: _removed, ...rest } = state.layoutsByInstance;
        if (state.layoutsByInstance[newId]) return { layoutsByInstance: rest };
        return { layoutsByInstance: { ...rest, [newId]: source } };
      }),

    removePaneLayout: (instanceId) =>
      set((state) => {
        if (!(instanceId in state.layoutsByInstance)) return {};
        const { [instanceId]: _removed, ...rest } = state.layoutsByInstance;
        return { layoutsByInstance: rest };
      }),

    prunePaneTab: (tabId) =>
      set((state) => {
        let changed = false;
        const next: Record<string, WindowSplit> = {};
        for (const [id, split] of Object.entries(state.layoutsByInstance)) {
          const holdsPrimary = split.primaryTabId === tabId;
          const holdsSecondary = split.secondaryTabId === tabId;
          if (!holdsPrimary && !holdsSecondary) {
            next[id] = split;
            continue;
          }
          changed = true;
          const pruned: WindowSplit = {
            ...split,
            primaryTabId: holdsPrimary ? null : split.primaryTabId,
            secondaryTabId: holdsSecondary ? null : split.secondaryTabId,
          };
          // No live pane left → nothing restorable; drop the stash.
          if (pruned.primaryTabId === null && pruned.secondaryTabId === null) continue;
          next[id] = pruned;
        }
        return changed ? { layoutsByInstance: next } : {};
      }),

    resetPaneLayouts: () => set({ layoutsByInstance: {} }),
  }),
);

// A hidden instance's pane tab can close (Close Others, MCP close, dirty-save
// flows) — prune immediately rather than waiting for restore validation.
onTabRemoved((_windowLabel, tabId) => {
  useWorkspacePaneLayoutsStore.getState().prunePaneTab(tabId);
});
