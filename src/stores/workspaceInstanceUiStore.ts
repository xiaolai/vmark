/**
 * Per-workspace-instance UI state (WI-9.1 / plan D2).
 *
 * Purpose: presentation state that must SWITCH with the workspace rail —
 * sidebar width/view mode, file-explorer folder-open + scroll state, and
 * outline state per tab. Kept in a PARALLEL store keyed by
 * `workspaceInstanceId` rather than on `WorkspaceInstanceRecord`: instance
 * records serialize through hot exit and window transfers, and mixing
 * presentation state into them would grow every migration.
 *
 * Lifecycle contract (tested):
 *   - duplicate → `copyInstanceUiState`
 *   - move → state stays (same id, new window)
 *   - identity re-key (`ensureLooseInstance`) → `rekeyInstanceUiState`
 *   - close → `removeInstanceUiState`
 *   - hot-exit restore → `hydrateInstanceUiStates` (tolerates missing state)
 *
 * Window-global UI (sidebar visibility, status bar, terminal, overlays,
 * editor prefs) intentionally does NOT live here.
 *
 * @coordinates-with services/workspaces/switchWorkspaceInstance.ts — restore on switch
 * @coordinates-with services/persistence/hotExit — capture/restore (WI-9.4)
 * @module stores/workspaceInstanceUiStore
 */
import { create } from "zustand";
import { onTabRemoved } from "@/stores/tabRemovalBus";

interface OutlineTabUiState {
  collapsedKeys: string[];
  filterQuery: string;
  scrollOffset: number;
}

export interface InstanceUiState {
  /** Sidebar width in px; null = window default. */
  sidebarWidth: number | null;
  /** Sidebar view mode id; null = window default. */
  sidebarViewMode: string | null;
  /** react-arborist folder-open map; null = tree default. */
  fileExplorerOpenState: Record<string, boolean> | null;
  /** File-tree scroll offset; null = top. Finite numbers only. */
  fileTreeScrollOffset: number | null;
  /** Outline presentation state per tab id. */
  outlineByTabId: Record<string, OutlineTabUiState>;
}

export const DEFAULT_INSTANCE_UI_STATE: InstanceUiState = {
  sidebarWidth: null,
  sidebarViewMode: null,
  fileExplorerOpenState: null,
  fileTreeScrollOffset: null,
  outlineByTabId: {},
};

const DEFAULT_OUTLINE_TAB_STATE: OutlineTabUiState = {
  collapsedKeys: [],
  filterQuery: "",
  scrollOffset: 0,
};

interface WorkspaceInstanceUiStoreState {
  instanceUiStates: Record<string, InstanceUiState>;
  getInstanceUiState: (instanceId: string) => InstanceUiState;
  updateInstanceUiState: (instanceId: string, partial: Partial<InstanceUiState>) => void;
  updateOutlineTabState: (
    instanceId: string,
    tabId: string,
    partial: Partial<OutlineTabUiState>,
  ) => void;
  removeOutlineTabState: (instanceId: string, tabId: string) => void;
  /** Strip a closed tab's outline state from EVERY instance (tab ids are global). */
  removeOutlineTabStateForTab: (tabId: string) => void;
  copyInstanceUiState: (fromId: string, toId: string) => void;
  rekeyInstanceUiState: (oldId: string, newId: string) => void;
  removeInstanceUiState: (instanceId: string) => void;
  hydrateInstanceUiStates: (states: Record<string, InstanceUiState>) => void;
  resetInstanceUiStates: () => void;
}

function cloneState(state: InstanceUiState): InstanceUiState {
  return {
    ...state,
    fileExplorerOpenState: state.fileExplorerOpenState
      ? { ...state.fileExplorerOpenState }
      : null,
    outlineByTabId: Object.fromEntries(
      Object.entries(state.outlineByTabId).map(([tabId, outline]) => [
        tabId,
        { ...outline, collapsedKeys: [...outline.collapsedKeys] },
      ]),
    ),
  };
}

/** Sanitize a partial update: non-finite scroll offsets are dropped. */
function sanitizePartial(partial: Partial<InstanceUiState>): Partial<InstanceUiState> {
  const next = { ...partial };
  if (
    next.fileTreeScrollOffset !== undefined &&
    next.fileTreeScrollOffset !== null &&
    !Number.isFinite(next.fileTreeScrollOffset)
  ) {
    delete next.fileTreeScrollOffset;
  }
  return next;
}

/** Shape guard for hydration — a malformed persisted entry is dropped. */
function isValidInstanceUiState(raw: unknown): raw is InstanceUiState {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Record<string, unknown>;
  const numOrNull = (v: unknown) => v === null || Number.isFinite(v);
  const strOrNull = (v: unknown) => v === null || typeof v === "string";
  return (
    numOrNull(s.sidebarWidth) &&
    strOrNull(s.sidebarViewMode) &&
    (s.fileExplorerOpenState === null || typeof s.fileExplorerOpenState === "object") &&
    numOrNull(s.fileTreeScrollOffset) &&
    typeof s.outlineByTabId === "object" &&
    s.outlineByTabId !== null
  );
}

export const useWorkspaceInstanceUiStore = create<WorkspaceInstanceUiStoreState>()(
  (set, get) => ({
    instanceUiStates: {},

    getInstanceUiState: (instanceId) =>
      get().instanceUiStates[instanceId] ?? DEFAULT_INSTANCE_UI_STATE,

    updateInstanceUiState: (instanceId, partial) =>
      set((state) => {
        const current = state.instanceUiStates[instanceId] ?? DEFAULT_INSTANCE_UI_STATE;
        return {
          instanceUiStates: {
            ...state.instanceUiStates,
            [instanceId]: { ...current, ...sanitizePartial(partial) },
          },
        };
      }),

    updateOutlineTabState: (instanceId, tabId, partial) =>
      set((state) => {
        const current = state.instanceUiStates[instanceId] ?? DEFAULT_INSTANCE_UI_STATE;
        const outline = current.outlineByTabId[tabId] ?? DEFAULT_OUTLINE_TAB_STATE;
        return {
          instanceUiStates: {
            ...state.instanceUiStates,
            [instanceId]: {
              ...current,
              outlineByTabId: {
                ...current.outlineByTabId,
                [tabId]: { ...outline, ...partial },
              },
            },
          },
        };
      }),

    removeOutlineTabState: (instanceId, tabId) =>
      set((state) => {
        const current = state.instanceUiStates[instanceId];
        if (!current || !(tabId in current.outlineByTabId)) return {};
        const { [tabId]: _removed, ...rest } = current.outlineByTabId;
        return {
          instanceUiStates: {
            ...state.instanceUiStates,
            [instanceId]: { ...current, outlineByTabId: rest },
          },
        };
      }),

    removeOutlineTabStateForTab: (tabId) =>
      set((state) => {
        let changed = false;
        const next: Record<string, InstanceUiState> = {};
        for (const [id, ui] of Object.entries(state.instanceUiStates)) {
          if (tabId in ui.outlineByTabId) {
            const { [tabId]: _removed, ...rest } = ui.outlineByTabId;
            next[id] = { ...ui, outlineByTabId: rest };
            changed = true;
          } else {
            next[id] = ui;
          }
        }
        return changed ? { instanceUiStates: next } : {};
      }),

    copyInstanceUiState: (fromId, toId) =>
      set((state) => {
        const source = state.instanceUiStates[fromId];
        if (!source) return {};
        return {
          instanceUiStates: { ...state.instanceUiStates, [toId]: cloneState(source) },
        };
      }),

    rekeyInstanceUiState: (oldId, newId) =>
      set((state) => {
        const source = state.instanceUiStates[oldId];
        if (!source) return {};
        const { [oldId]: _removed, ...rest } = state.instanceUiStates;
        // An existing target entry wins — re-key must not clobber real state.
        if (state.instanceUiStates[newId]) return { instanceUiStates: rest };
        return { instanceUiStates: { ...rest, [newId]: source } };
      }),

    removeInstanceUiState: (instanceId) =>
      set((state) => {
        if (!(instanceId in state.instanceUiStates)) return {};
        const { [instanceId]: _removed, ...rest } = state.instanceUiStates;
        return { instanceUiStates: rest };
      }),

    hydrateInstanceUiStates: (states) =>
      set((state) => {
        const valid: Record<string, InstanceUiState> = {};
        for (const [id, raw] of Object.entries(states)) {
          if (isValidInstanceUiState(raw)) valid[id] = raw;
        }
        return { instanceUiStates: { ...state.instanceUiStates, ...valid } };
      }),

    resetInstanceUiStates: () => set({ instanceUiStates: {} }),
  }),
);

// A tab leaving its window (close or detach) must not leave orphaned outline
// state behind — same bus-driven cleanup pattern as paneStore's split collapse.
onTabRemoved((_windowLabel, tabId) => {
  useWorkspaceInstanceUiStore.getState().removeOutlineTabStateForTab(tabId);
});
