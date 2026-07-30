import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import { uniqueIds } from "@/stores/workspaceInstancesStore/helpers";
import { useTabStore, tabFilePath } from "@/stores/tabStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { partitionWindowTabs } from "@/services/workspaces/workspaceOwnershipKernel";
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
 *
 * A recreated tab is claimed by AT MOST ONE instance: if two persisted
 * instances list the same old tab id (a corrupt or drifted snapshot), the first
 * instance in window order wins. Handing the same tab to two workspaces breaks
 * exclusive ownership — a later move/close of one workspace would then take a
 * tab the other still lists.
 */
function buildAssignments(
  instances: WorkspaceInstanceRecord[],
  tabIdMap: Map<string, string>,
): Map<string, string[]> {
  const assignments = new Map<string, string[]>();
  const claimed = new Set<string>();
  for (const instance of instances) {
    const mapped: string[] = [];
    for (const oldId of instance.tabIds) {
      const newId = tabIdMap.get(oldId);
      if (!newId || claimed.has(newId)) continue;
      claimed.add(newId);
      mapped.push(newId);
    }
    assignments.set(instance.workspaceInstanceId, mapped);
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
      filePath: tabFilePath(tab),
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
  // Only DOCUMENT tabs need a loose owner — browser tabs are window-global
  // (D1) and never demand an instance.
  const needsLoose = useTabStore.getState().getTabsByWindow(windowLabel).some(
    (tab) =>
      tab.kind === "document" &&
      classifyWorkspaceContextForTab({
        filePath: tabFilePath(tab),
        instances,
        activeWorkspaceInstanceId: activeId,
      }) === null,
  );
  if (!needsLoose) return;

  // Structural since WI-13.1: ensureLooseInstance preserves a valid current
  // activation, so capture-time ownership repair cannot flip the live rail.
  useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel);
}

function serializeInstancesWithCurrentTabs(
  windowLabel: string,
  ids: string[],
  activeInstanceId: string | null,
): HotExitWorkspaceInstanceState[] {
  const instances = orderedWindowInstances(windowLabel);
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

  // Partition each tab exactly once through the shared ownership kernel
  // (WI-1R). Browser tabs land in the window-global BROWSER_SCOPE (D1) and are
  // therefore never serialized into any instance's tabIds/closedTabIds — their
  // persistence is the window session (WI-8.2), not workspace instances.
  // Closed-tab ids project straight from the SCOPED history (WI-11.1), which
  // is already keyed by instance.
  const ownedTabIds = partitionWindowTabs(tabs, instances, activeInstanceId).byScope;
  const closedScopes = useClosedTabScopesStore.getState();

  return ids.map((id) => {
    const instance = useWorkspaceInstancesStore.getState().instances[id];
    const tabIds = ownedTabIds.get(id) ?? [];
    const closedTabIds = closedScopes.closedIdsForScope(windowLabel, id);
    return {
      ...instance,
      tabIds,
      activeTabId:
        activeTabId !== null && tabIds.includes(activeTabId) ? activeTabId : tabIds[0] ?? null,
      closedTabIds,
    };
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
