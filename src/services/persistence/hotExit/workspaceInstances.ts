import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import type {
  HotExitWindowWorkspaceState,
  HotExitWorkspaceInstanceState,
  WindowState,
} from "./types";
import {
  chooseActiveIdForRestoredInstances,
  orderedValidIds,
  parseWindowInstances,
  synthesizeWindowInstances,
} from "./workspaceInstanceRestoreData";
import {
  classifyWorkspaceContextForTab,
  orderedWindowInstances,
} from "@/services/workspaces/workspaceContextOwnership";

const EMPTY_WINDOW_WORKSPACE_STATE: HotExitWindowWorkspaceState = {
  workspace_instance_ids: [],
  active_workspace_instance_id: null,
  workspace_instances: [],
};

export function captureWindowWorkspaceInstances(
  windowLabel: string
): HotExitWindowWorkspaceState {
  if (!isWorkspaceRailEnabled()) return EMPTY_WINDOW_WORKSPACE_STATE;

  ensureLooseInstanceForUnownedTabs(windowLabel);

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
    workspace_instances: serializeInstancesWithCurrentTabs(windowLabel, ids, activeId),
  };
}

export interface RestoreWorkspaceInstancesOptions {
  legacyWorkspaceRoot?: string | null;
}

export function restoreWindowWorkspaceInstances(
  windowLabel: string,
  windowState: WindowState,
  options: RestoreWorkspaceInstancesOptions = {},
): void {
  if (!isWorkspaceRailEnabled()) return;

  const instances = parseWindowInstances(windowLabel, windowState);
  const restoredInstances = instances.length > 0
    ? instances
    : synthesizeWindowInstances(windowLabel, windowState, options.legacyWorkspaceRoot ?? null);
  if (restoredInstances.length === 0) return;

  const store = useWorkspaceInstancesStore.getState();
  const existingIds = store.windows[windowLabel]?.workspaceInstanceIds ?? [];
  const ids = orderedValidIds(windowState.workspace_instance_ids, restoredInstances);

  for (const instance of restoredInstances) {
    store.addWorkspaceInstance(instance);
  }

  if (existingIds.length === 0) {
    useWorkspaceInstancesStore.getState().reorderWorkspaceInstances(windowLabel, ids);
  }

  const activeId = chooseActiveIdForRestoredInstances(
    windowState,
    restoredInstances,
    ids,
  );
  if (activeId) {
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(windowLabel, activeId);
  }
}

export function reconcileRestoredWindowWorkspaceInstances(
  windowLabel: string,
  windowState: WindowState,
  tabIdMap: Map<string, string>,
): void {
  if (!isWorkspaceRailEnabled()) return;
  const instances = orderedWindowInstances(windowLabel);
  if (instances.length === 0) return;

  const assignments = new Map<string, string[]>();
  for (const instance of instances) {
    const mapped = instance.tabIds
      .map((id) => tabIdMap.get(id))
      .filter((id): id is string => Boolean(id));
    assignments.set(instance.workspaceInstanceId, uniqueIds(mapped));
  }

  const owned = new Set([...assignments.values()].flat());
  for (const tab of useTabStore.getState().getTabsByWindow(windowLabel)) {
    if (owned.has(tab.id)) continue;
    let owner = classifyWorkspaceContextForTab({
      filePath: tab.filePath,
      instances: orderedWindowInstances(windowLabel),
      activeWorkspaceInstanceId:
        useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null,
    });
    if (!owner) {
      owner = useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
    }
    const ids = assignments.get(owner.workspaceInstanceId) ?? [];
    ids.push(tab.id);
    assignments.set(owner.workspaceInstanceId, uniqueIds(ids));
  }

  const restoredActiveTabId = windowState.active_tab_id
    ? tabIdMap.get(windowState.active_tab_id) ?? null
    : null;
  for (const instance of orderedWindowInstances(windowLabel)) {
    const tabIds = assignments.get(instance.workspaceInstanceId) ?? [];
    const activeTabId = instance.activeTabId
      ? tabIdMap.get(instance.activeTabId) ?? instance.activeTabId
      : null;
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      instance.workspaceInstanceId,
      tabIds,
      activeTabId,
      instance.closedTabIds,
    );
  }

  const activeInstanceId = chooseActiveInstanceAfterReconcile(
    windowLabel,
    windowState.active_workspace_instance_id,
    restoredActiveTabId,
  );
  if (activeInstanceId) {
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(windowLabel, activeInstanceId);
  }
}

function ensureLooseInstanceForUnownedTabs(windowLabel: string): void {
  const instances = orderedWindowInstances(windowLabel);
  if (instances.length === 0) return;
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const needsLoose = useTabStore.getState().getTabsByWindow(windowLabel).some((tab) =>
    classifyWorkspaceContextForTab({ filePath: tab.filePath, instances, activeWorkspaceInstanceId: activeId }) === null
  );
  if (needsLoose) {
    useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
  }
}

function serializeInstancesWithCurrentTabs(
  windowLabel: string,
  ids: string[],
  activeInstanceId: string | null,
): HotExitWorkspaceInstanceState[] {
  const instances = orderedWindowInstances(windowLabel);
  const activeId = activeInstanceId;
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const closedTabs = useTabStore.getState().closedTabs[windowLabel] ?? [];
  return ids.map((id) => {
    const instance = useWorkspaceInstancesStore.getState().instances[id];
    const tabIds = tabs
      .filter((tab) => classifyWorkspaceContextForTab({
        filePath: tab.filePath,
        instances,
        activeWorkspaceInstanceId: activeId,
      })?.workspaceInstanceId === id)
      .map((tab) => tab.id);
    const closedTabIds = closedTabs
      .filter((tab) => classifyClosedTab(tab, instances, activeId)?.workspaceInstanceId === id)
      .map((tab) => tab.id);
    return {
      ...instance,
      tabIds,
      activeTabId: tabIds.includes(useTabStore.getState().activeTabId[windowLabel] ?? "")
        ? useTabStore.getState().activeTabId[windowLabel]
        : tabIds[0] ?? null,
      closedTabIds,
    };
  });
}

function classifyClosedTab(
  tab: Tab,
  instances: WorkspaceInstanceRecord[],
  activeWorkspaceInstanceId: string | null,
): WorkspaceInstanceRecord | null {
  return classifyWorkspaceContextForTab({
    filePath: tab.filePath,
    instances,
    activeWorkspaceInstanceId,
  });
}

function chooseActiveInstanceAfterReconcile(
  windowLabel: string,
  rawActiveId: string | null | undefined,
  activeTabId: string | null,
): string | null {
  const instances = orderedWindowInstances(windowLabel);
  if (rawActiveId && instances.some((instance) => instance.workspaceInstanceId === rawActiveId)) {
    return rawActiveId;
  }
  if (activeTabId) {
    const containing = instances.find((instance) => instance.tabIds.includes(activeTabId));
    if (containing) return containing.workspaceInstanceId;
  }
  return instances.find((instance) => instance.kind !== "placeholder")?.workspaceInstanceId
    ?? instances[0]?.workspaceInstanceId
    ?? null;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
