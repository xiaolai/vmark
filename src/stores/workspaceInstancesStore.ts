import { create } from "zustand";
import {
  createWorkspaceInstance,
  type WorkspaceInstanceIdentity,
} from "@/utils/workspaceIdentity";

export type WorkspaceInstanceRecord = WorkspaceInstanceIdentity;

export interface WindowWorkspaceState {
  windowLabel: string;
  workspaceInstanceIds: string[];
  activeWorkspaceInstanceId: string | null;
}

interface WorkspaceInstancesState {
  instances: Record<string, WorkspaceInstanceRecord>;
  windows: Record<string, WindowWorkspaceState>;
  addWorkspaceInstance: (instance: WorkspaceInstanceRecord) => void;
  activateWorkspaceInstance: (windowLabel: string, instanceId: string) => void;
  reorderWorkspaceInstances: (windowLabel: string, orderedIds: string[]) => void;
  removeWorkspaceInstance: (windowLabel: string, instanceId: string) => void;
  ensurePlaceholderInstance: (windowLabel: string, placeholderId: string) => void;
  resetWorkspaceInstances: () => void;
}

const emptyWindowState = (windowLabel: string): WindowWorkspaceState => ({
  windowLabel,
  workspaceInstanceIds: [],
  activeWorkspaceInstanceId: null,
});

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
      const ids = target.workspaceInstanceIds.includes(instance.workspaceInstanceId)
        ? target.workspaceInstanceIds
        : [...target.workspaceInstanceIds, instance.workspaceInstanceId];
      windows[instance.ownerWindowLabel] = {
        ...target,
        workspaceInstanceIds: ids,
        activeWorkspaceInstanceId: target.activeWorkspaceInstanceId ?? instance.workspaceInstanceId,
      };

      return {
        instances: { ...state.instances, [instance.workspaceInstanceId]: instance },
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
      const ordered = orderedIds.filter((id) => current.includes(id));
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

function removeFromWindow(
  windowState: WindowWorkspaceState,
  instanceId: string
): WindowWorkspaceState {
  const ids = windowState.workspaceInstanceIds.filter((id) => id !== instanceId);
  return {
    ...windowState,
    workspaceInstanceIds: ids,
    activeWorkspaceInstanceId:
      windowState.activeWorkspaceInstanceId === instanceId
        ? ids[0] ?? null
        : windowState.activeWorkspaceInstanceId,
  };
}
