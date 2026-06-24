import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import type {
  HotExitWindowWorkspaceState,
  HotExitWorkspaceInstanceState,
  WindowState,
} from "./types";
import type { WorkspaceInstanceCreatedFrom } from "@/utils/workspaceIdentity";

const EMPTY_WINDOW_WORKSPACE_STATE: HotExitWindowWorkspaceState = {
  workspace_instance_ids: [],
  active_workspace_instance_id: null,
  workspace_instances: [],
};

const CREATED_FROM_VALUES = new Set<string>([
  "open",
  "finderOpen",
  "duplicate",
  "dragOut",
  "restore",
  "placeholder",
]);

export function captureWindowWorkspaceInstances(
  windowLabel: string
): HotExitWindowWorkspaceState {
  if (!isWorkspaceRailEnabled()) return EMPTY_WINDOW_WORKSPACE_STATE;

  const state = useWorkspaceInstancesStore.getState();
  const windowState = state.windows[windowLabel];
  if (!windowState) return EMPTY_WINDOW_WORKSPACE_STATE;

  const ids = windowState.workspaceInstanceIds.filter(
    (id) => state.instances[id]?.ownerWindowLabel === windowLabel
  );
  const activeId = ids.includes(windowState.activeWorkspaceInstanceId ?? "")
    ? windowState.activeWorkspaceInstanceId
    : ids[0] ?? null;

  return {
    workspace_instance_ids: ids,
    active_workspace_instance_id: activeId,
    workspace_instances: ids.map((id) => state.instances[id]),
  };
}

export function restoreWindowWorkspaceInstances(
  windowLabel: string,
  windowState: WindowState
): void {
  if (!isWorkspaceRailEnabled()) return;

  const instances = parseWindowInstances(windowLabel, windowState);
  if (instances.length === 0) return;

  const store = useWorkspaceInstancesStore.getState();
  const existingIds = store.windows[windowLabel]?.workspaceInstanceIds ?? [];
  const ids = orderedValidIds(windowState.workspace_instance_ids, instances);

  for (const instance of instances) {
    store.addWorkspaceInstance(instance);
  }

  if (existingIds.length === 0) {
    useWorkspaceInstancesStore.getState().reorderWorkspaceInstances(windowLabel, ids);
  }

  const activeId = ids.includes(windowState.active_workspace_instance_id ?? "")
    ? windowState.active_workspace_instance_id
    : ids[0] ?? null;
  if (activeId) {
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(windowLabel, activeId);
  }
}

function parseWindowInstances(
  windowLabel: string,
  windowState: WindowState
): WorkspaceInstanceRecord[] {
  const rawInstances = windowState.workspace_instances;
  if (!Array.isArray(rawInstances)) return [];
  return rawInstances
    .filter(isHotExitWorkspaceInstanceState)
    .map((instance) => ({
      ...instance,
      ownerWindowLabel: windowLabel,
      createdFrom: parseCreatedFrom(instance.createdFrom),
    }));
}

function orderedValidIds(
  rawIds: string[] | undefined,
  instances: WorkspaceInstanceRecord[]
): string[] {
  const validIds = new Set(instances.map((instance) => instance.workspaceInstanceId));
  const ordered = Array.isArray(rawIds)
    ? rawIds.filter((id) => validIds.has(id))
    : [];
  const omitted = [...validIds].filter((id) => !ordered.includes(id));
  return [...ordered, ...omitted];
}

function isHotExitWorkspaceInstanceState(
  value: unknown
): value is HotExitWorkspaceInstanceState {
  if (typeof value !== "object" || value === null) return false;
  const instance = value as Record<string, unknown>;
  return (
    typeof instance.workspaceInstanceId === "string" &&
    (instance.rootId === null || typeof instance.rootId === "string") &&
    (instance.rootPath === null || typeof instance.rootPath === "string") &&
    typeof instance.displayName === "string" &&
    typeof instance.ownerWindowLabel === "string" &&
    typeof instance.createdFrom === "string" &&
    (instance.activeTabId === null || typeof instance.activeTabId === "string") &&
    Array.isArray(instance.tabIds) &&
    instance.tabIds.every((id) => typeof id === "string") &&
    Array.isArray(instance.closedTabIds) &&
    instance.closedTabIds.every((id) => typeof id === "string")
  );
}

function parseCreatedFrom(value: string): WorkspaceInstanceCreatedFrom {
  return CREATED_FROM_VALUES.has(value)
    ? (value as WorkspaceInstanceCreatedFrom)
    : "restore";
}
