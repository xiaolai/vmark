import { create } from "zustand";
import { createWorkspaceInstance, generateUUID } from "@/utils/workspaceIdentity";
import {
  emptyWindowState,
  removeFromWindow,
  removePlaceholdersFromWindow,
  uniqueIds,
  type WindowWorkspaceState,
  type WorkspaceInstanceRecord,
} from "./workspaceInstancesStore/helpers";

export type { WindowWorkspaceState, WorkspaceInstanceRecord } from "./workspaceInstancesStore/helpers";

interface WorkspaceInstancesState {
  instances: Record<string, WorkspaceInstanceRecord>;
  windows: Record<string, WindowWorkspaceState>;
  addWorkspaceInstance: (instance: WorkspaceInstanceRecord) => void;
  activateWorkspaceInstance: (windowLabel: string, instanceId: string) => void;
  reorderWorkspaceInstances: (windowLabel: string, orderedIds: string[]) => void;
  removeWorkspaceInstance: (windowLabel: string, instanceId: string) => void;
  ensurePlaceholderInstance: (windowLabel: string, placeholderId: string) => void;
  ensureLooseInstance: (windowLabel: string, instanceId?: string) => WorkspaceInstanceRecord;
  setWorkspaceInstanceTabs: (
    instanceId: string,
    tabIds: string[],
    activeTabId: string | null,
    closedTabIds?: string[],
  ) => void;
  resetWorkspaceInstances: () => void;
}

export const useWorkspaceInstancesStore = create<WorkspaceInstancesState>()((set) => ({
  instances: {},
  windows: {},

  addWorkspaceInstance: (instance) =>
    set((state) => {
      const previous = state.instances[instance.workspaceInstanceId];
      const windows = { ...state.windows };
      if (previous && previous.ownerWindowLabel !== instance.ownerWindowLabel) {
        windows[previous.ownerWindowLabel] = removeFromWindow(
          windows[previous.ownerWindowLabel] ?? emptyWindowState(previous.ownerWindowLabel),
          instance.workspaceInstanceId
        );
      }

      const target = windows[instance.ownerWindowLabel] ?? emptyWindowState(instance.ownerWindowLabel);
      const realInstance = instance.kind !== "placeholder";
      const targetWithoutPlaceholders = realInstance
        ? removePlaceholdersFromWindow(target, state.instances)
        : target;
      const placeholderIds = realInstance
        ? target.workspaceInstanceIds.filter(
          (id) => state.instances[id]?.kind === "placeholder",
        )
        : [];
      const ids = target.workspaceInstanceIds.includes(instance.workspaceInstanceId)
        ? targetWithoutPlaceholders.workspaceInstanceIds
        : [...targetWithoutPlaceholders.workspaceInstanceIds, instance.workspaceInstanceId];
      const nextInstances = { ...state.instances, [instance.workspaceInstanceId]: instance };
      for (const id of placeholderIds) {
        delete nextInstances[id];
      }
      windows[instance.ownerWindowLabel] = {
        ...targetWithoutPlaceholders,
        workspaceInstanceIds: ids,
        activeWorkspaceInstanceId: ids.includes(target.activeWorkspaceInstanceId ?? "")
          ? target.activeWorkspaceInstanceId
          : instance.workspaceInstanceId,
      };

      return {
        instances: nextInstances,
        windows,
      };
    }),

  activateWorkspaceInstance: (windowLabel, instanceId) =>
    set((state) => {
      const windowState = state.windows[windowLabel];
      if (!windowState?.workspaceInstanceIds.includes(instanceId)) return {};
      return {
        windows: {
          ...state.windows,
          [windowLabel]: { ...windowState, activeWorkspaceInstanceId: instanceId },
        },
      };
    }),

  reorderWorkspaceInstances: (windowLabel, orderedIds) =>
    set((state) => {
      const windowState = state.windows[windowLabel];
      if (!windowState) return {};
      const current = windowState.workspaceInstanceIds;
      // De-duplicate first: a repeated id in orderedIds would otherwise survive
      // the filter and list the same instance twice.
      const ordered = uniqueIds(orderedIds).filter((id) => current.includes(id));
      const omitted = current.filter((id) => !ordered.includes(id));
      const nextIds = [...ordered, ...omitted];
      const active = nextIds.includes(windowState.activeWorkspaceInstanceId ?? "")
        ? windowState.activeWorkspaceInstanceId
        : nextIds[0] ?? null;
      return {
        windows: {
          ...state.windows,
          [windowLabel]: {
            ...windowState,
            workspaceInstanceIds: nextIds,
            activeWorkspaceInstanceId: active,
          },
        },
      };
    }),

  removeWorkspaceInstance: (windowLabel, instanceId) =>
    set((state) => {
      const windowState = state.windows[windowLabel];
      if (!windowState?.workspaceInstanceIds.includes(instanceId)) return {};
      const { [instanceId]: _removed, ...instances } = state.instances;
      return {
        instances,
        windows: {
          ...state.windows,
          [windowLabel]: removeFromWindow(windowState, instanceId),
        },
      };
    }),

  ensurePlaceholderInstance: (windowLabel, placeholderId) =>
    set((state) => {
      const windowState = state.windows[windowLabel] ?? emptyWindowState(windowLabel);
      if (windowState.workspaceInstanceIds.length > 0) return {};
      const placeholder = createWorkspaceInstance({
        workspaceInstanceId: placeholderId,
        root: null,
        ownerWindowLabel: windowLabel,
        createdFrom: "placeholder",
        kind: "placeholder",
      });
      return {
        instances: { ...state.instances, [placeholderId]: placeholder },
        windows: {
          ...state.windows,
          [windowLabel]: {
            ...windowState,
            workspaceInstanceIds: [placeholderId],
            activeWorkspaceInstanceId: placeholderId,
          },
        },
      };
    }),

  ensureLooseInstance: (windowLabel, instanceId) => {
    let result: WorkspaceInstanceRecord | null = null;
    set((state) => {
      const windowState = state.windows[windowLabel] ?? emptyWindowState(windowLabel);
      const existingId = windowState.workspaceInstanceIds.find(
        (id) => state.instances[id]?.kind === "loose",
      );
      if (existingId) {
        // A loose instance already exists. If the caller requested a specific id
        // (transfer restore acks payload.workspaceInstanceId) and it differs,
        // re-key the existing instance to the requested id so the ack and tab
        // ownership reference the same instance.
        if (instanceId && instanceId !== existingId) {
          const renamed: WorkspaceInstanceRecord = {
            ...state.instances[existingId],
            workspaceInstanceId: instanceId,
          };
          const { [existingId]: _old, ...rest } = state.instances;
          result = renamed;
          return {
            instances: { ...rest, [instanceId]: renamed },
            windows: {
              ...state.windows,
              [windowLabel]: {
                ...windowState,
                workspaceInstanceIds: windowState.workspaceInstanceIds.map((id) =>
                  id === existingId ? instanceId : id,
                ),
                activeWorkspaceInstanceId: instanceId,
              },
            },
          };
        }
        result = state.instances[existingId];
        return {
          windows: {
            ...state.windows,
            [windowLabel]: {
              ...windowState,
              activeWorkspaceInstanceId: existingId,
            },
          },
        };
      }

      const looseId = instanceId ?? `wsi-loose-${generateUUID()}`;
      const placeholderIds = windowState.workspaceInstanceIds.filter(
        (id) => state.instances[id]?.kind === "placeholder",
      );
      const ids = [
        ...windowState.workspaceInstanceIds.filter((id) => !placeholderIds.includes(id)),
        looseId,
      ];
      const nextInstances = { ...state.instances };
      for (const id of placeholderIds) {
        delete nextInstances[id];
      }
      const loose = createWorkspaceInstance({
        workspaceInstanceId: looseId,
        root: null,
        ownerWindowLabel: windowLabel,
        createdFrom: "open",
        kind: "loose",
      });
      result = loose;
      nextInstances[looseId] = loose;
      return {
        instances: nextInstances,
        windows: {
          ...state.windows,
          [windowLabel]: {
            ...windowState,
            workspaceInstanceIds: ids,
            activeWorkspaceInstanceId: looseId,
          },
        },
      };
    });

    if (!result) {
      throw new Error(`Failed to create loose workspace instance for window '${windowLabel}'`);
    }
    return result;
  },

  setWorkspaceInstanceTabs: (instanceId, tabIds, activeTabId, closedTabIds = []) =>
    set((state) => {
      const instance = state.instances[instanceId];
      if (!instance) return {};
      const uniqueTabIds = uniqueIds(tabIds);
      const uniqueClosedTabIds = uniqueIds(closedTabIds);
      return {
        instances: {
          ...state.instances,
          [instanceId]: {
            ...instance,
            tabIds: uniqueTabIds,
            activeTabId: activeTabId && uniqueTabIds.includes(activeTabId)
              ? activeTabId
              : uniqueTabIds[0] ?? null,
            closedTabIds: uniqueClosedTabIds,
          },
        },
      };
    }),

  resetWorkspaceInstances: () => set({ instances: {}, windows: {} }),
}));

export function selectWindowWorkspaceState(
  state: WorkspaceInstancesState,
  windowLabel: string
): WindowWorkspaceState | null {
  return state.windows[windowLabel] ?? null;
}

export function selectActiveWorkspaceInstance(
  state: WorkspaceInstancesState,
  windowLabel: string
): WorkspaceInstanceRecord | null {
  const activeId = state.windows[windowLabel]?.activeWorkspaceInstanceId;
  return activeId ? state.instances[activeId] ?? null : null;
}
