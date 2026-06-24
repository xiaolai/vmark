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

  const assignments = buildAssignments(instances, tabIdMap);
  claimUnownedTabs(windowLabel, assignments);
  applyAssignments(windowLabel, assignments, tabIdMap);

  const restoredActiveTabId = windowState.active_tab_id
    ? tabIdMap.get(windowState.active_tab_id) ?? null
    : null;
  const activeInstanceId = chooseActiveInstanceAfterReconcile(
    windowLabel,
    windowState.active_workspace_instance_id,
    restoredActiveTabId,
  );
  if (activeInstanceId) {
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(windowLabel, activeInstanceId);
  }
}

/**
 * Seed each instance's restored tab list by remapping its persisted (old) tab
 * ids through the hot-exit recreation map. Stale ids that didn't recreate are
 * dropped; duplicates are collapsed.
 */
function buildAssignments(
  instances: WorkspaceInstanceRecord[],
  tabIdMap: Map<string, string>,
): Map<string, string[]> {
  const assignments = new Map<string, string[]>();
  for (const instance of instances) {
    const mapped = instance.tabIds
      .map((id) => tabIdMap.get(id))
      .filter((id): id is string => Boolean(id));
    assignments.set(instance.workspaceInstanceId, uniqueIds(mapped));
  }
  return assignments;
}

/**
 * Assign every restored tab that no instance claimed to its classified owner
 * (or a freshly-ensured loose context), mutating `assignments` in place.
 */
function claimUnownedTabs(
  windowLabel: string,
  assignments: Map<string, string[]>,
): void {
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
}

/**
 * Write the reconciled tab lists (plus remapped active/closed ids) back to the
 * store for every window instance.
 */
function applyAssignments(
  windowLabel: string,
  assignments: Map<string, string[]>,
  tabIdMap: Map<string, string>,
): void {
  for (const instance of orderedWindowInstances(windowLabel)) {
    const tabIds = assignments.get(instance.workspaceInstanceId) ?? [];
    const activeTabId = instance.activeTabId
      ? tabIdMap.get(instance.activeTabId) ?? null
      : null;
    const closedTabIds = instance.closedTabIds
      .map((id) => tabIdMap.get(id))
      .filter((id): id is string => Boolean(id));
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      instance.workspaceInstanceId,
      tabIds,
      activeTabId,
      closedTabIds,
    );
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
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const closedTabs = useTabStore.getState().closedTabs[windowLabel] ?? [];
  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

  // Classify each tab exactly once into its owning instance, then read the
  // per-instance lists from those maps. This keeps capture O(tabs) instead of
  // O(instances * tabs) and guarantees a single, consistent ownership decision
  // per tab regardless of how active-instance ties resolve.
  const ownedTabIds = assignTabsToInstances(tabs, instances, activeInstanceId);
  const ownedClosedTabIds = assignTabsToInstances(closedTabs, instances, activeInstanceId);

  return ids.map((id) => {
    const instance = useWorkspaceInstancesStore.getState().instances[id];
    const tabIds = ownedTabIds.get(id) ?? [];
    const closedTabIds = ownedClosedTabIds.get(id) ?? [];
    return {
      ...instance,
      tabIds,
      activeTabId:
        activeTabId !== null && tabIds.includes(activeTabId) ? activeTabId : tabIds[0] ?? null,
      closedTabIds,
    };
  });
}

/**
 * Classify each tab once into its owning instance id, returning an
 * instanceId -> tabIds map that preserves the input tab order.
 */
function assignTabsToInstances(
  tabs: Tab[],
  instances: WorkspaceInstanceRecord[],
  activeWorkspaceInstanceId: string | null,
): Map<string, string[]> {
  const owned = new Map<string, string[]>();
  for (const tab of tabs) {
    const owner = classifyWorkspaceContextForTab({
      filePath: tab.filePath,
      instances,
      activeWorkspaceInstanceId,
    });
    if (!owner) continue;
    const list = owned.get(owner.workspaceInstanceId) ?? [];
    list.push(tab.id);
    owned.set(owner.workspaceInstanceId, list);
  }
  return owned;
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
