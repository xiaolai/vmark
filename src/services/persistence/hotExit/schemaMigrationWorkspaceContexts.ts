import type {
  HotExitWorkspaceInstanceState,
  SessionData,
  TabState,
} from './types';
import { createWorkspaceRootIdentity } from '@/utils/workspaceIdentity';
import { isWithinRoot } from '@/utils/paths';

type WindowState = SessionData['windows'][number];

export function addWorkspaceContextKindsToSession(session: SessionData): SessionData {
  const legacyWorkspaceRoot = session.workspace?.is_workspace_mode
    ? session.workspace.root_path
    : null;
  return {
    ...session,
    version: 5,
    windows: session.windows.map((window) =>
      addWorkspaceContextKinds(window, legacyWorkspaceRoot),
    ),
  };
}

function addWorkspaceContextKinds(
  window: WindowState,
  legacyWorkspaceRoot: string | null,
): WindowState {
  const incomingInstances = Array.isArray(window.workspace_instances)
    ? window.workspace_instances
    : [];
  const normalized = incomingInstances
    .filter(isMigratableWorkspaceInstance)
    .map((instance) => normalizeWorkspaceInstanceForV5(instance, window.window_label));
  const instances = normalized.length > 0
    ? normalized
    : synthesizeWorkspaceInstances(window, legacyWorkspaceRoot);
  const ids = orderedMigratedIds(window.workspace_instance_ids, instances);
  const activeId = chooseActiveWorkspaceInstanceId(
    window.active_workspace_instance_id,
    window.active_tab_id,
    instances,
    ids,
  );
  return {
    ...window,
    workspace_instance_ids: ids,
    active_workspace_instance_id: activeId,
    workspace_instances: instances,
  };
}

function isMigratableWorkspaceInstance(
  value: unknown,
): value is HotExitWorkspaceInstanceState {
  return typeof value === 'object' && value !== null
    && typeof (value as HotExitWorkspaceInstanceState).workspaceInstanceId === 'string';
}

function normalizeWorkspaceInstanceForV5(
  instance: HotExitWorkspaceInstanceState,
  windowLabel: string,
): HotExitWorkspaceInstanceState {
  const kind = instance.kind === 'workspace'
    || instance.kind === 'loose'
    || instance.kind === 'placeholder'
    ? instance.kind
    : inferMigratedKind(instance);
  return {
    ...instance,
    kind,
    ownerWindowLabel: windowLabel,
    rootId: kind === 'workspace' ? instance.rootId : null,
    rootPath: kind === 'workspace' ? instance.rootPath : null,
    displayName: kind === 'loose' ? 'Loose Files' : instance.displayName,
    tabIds: uniqueStrings(instance.tabIds),
    closedTabIds: uniqueStrings(instance.closedTabIds),
    activeTabId: instance.activeTabId,
    unavailableRoot: instance.unavailableRoot ?? false,
  };
}

function inferMigratedKind(
  instance: HotExitWorkspaceInstanceState,
): 'workspace' | 'loose' | 'placeholder' {
  if (instance.rootPath) return 'workspace';
  if (instance.createdFrom === 'placeholder' && instance.tabIds.length === 0) {
    return 'placeholder';
  }
  return 'loose';
}

function synthesizeWorkspaceInstances(
  window: WindowState,
  legacyWorkspaceRoot: string | null,
): HotExitWorkspaceInstanceState[] {
  const meaningfulTabs = window.tabs ?? [];
  if (meaningfulTabs.length === 0) return [];

  const workspaceTabs: TabState[] = [];
  const looseTabs: TabState[] = [];
  for (const tab of meaningfulTabs) {
    if (legacyWorkspaceRoot && tab.file_path && isWithinRoot(legacyWorkspaceRoot, tab.file_path)) {
      workspaceTabs.push(tab);
    } else {
      looseTabs.push(tab);
    }
  }

  const result: HotExitWorkspaceInstanceState[] = [];
  if (legacyWorkspaceRoot && workspaceTabs.length > 0) {
    const root = createWorkspaceRootIdentity(legacyWorkspaceRoot, { platform: 'macos' });
    result.push({
      workspaceInstanceId: `wsi-legacy-${window.window_label}-workspace`,
      kind: 'workspace',
      rootId: root.ok ? root.root.rootId : `path:macos:${legacyWorkspaceRoot}`,
      rootPath: legacyWorkspaceRoot,
      displayName: root.ok ? root.root.displayName : legacyWorkspaceRoot,
      ownerWindowLabel: window.window_label,
      createdFrom: 'restore',
      activeTabId: activeTabInList(window.active_tab_id, workspaceTabs),
      tabIds: workspaceTabs.map((tab) => tab.id),
      closedTabIds: [],
      unavailableRoot: false,
    });
  }
  if (looseTabs.length > 0) {
    result.push({
      workspaceInstanceId: `wsi-legacy-${window.window_label}-loose`,
      kind: 'loose',
      rootId: null,
      rootPath: null,
      displayName: 'Loose Files',
      ownerWindowLabel: window.window_label,
      createdFrom: 'restore',
      activeTabId: activeTabInList(window.active_tab_id, looseTabs),
      tabIds: looseTabs.map((tab) => tab.id),
      closedTabIds: [],
      unavailableRoot: false,
    });
  }
  return result;
}

function activeTabInList(activeTabId: string | null, tabs: TabState[]): string | null {
  if (!activeTabId) return null;
  return tabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
}

function orderedMigratedIds(
  rawIds: string[] | undefined,
  instances: HotExitWorkspaceInstanceState[],
): string[] {
  const valid = new Set(instances.map((instance) => instance.workspaceInstanceId));
  const ordered = Array.isArray(rawIds)
    ? rawIds.filter((id) => valid.has(id))
    : [];
  const omitted = instances
    .map((instance) => instance.workspaceInstanceId)
    .filter((id) => !ordered.includes(id));
  return [...ordered, ...omitted];
}

function chooseActiveWorkspaceInstanceId(
  rawActiveId: string | null | undefined,
  activeTabId: string | null,
  instances: HotExitWorkspaceInstanceState[],
  ids: string[],
): string | null {
  if (rawActiveId && ids.includes(rawActiveId)) return rawActiveId;
  const byActiveTab = activeTabId
    ? instances.find((instance) => instance.tabIds.includes(activeTabId))
    : null;
  if (byActiveTab) return byActiveTab.workspaceInstanceId;
  return ids.find((id) => {
    const instance = instances.find((candidate) => candidate.workspaceInstanceId === id);
    return instance?.kind !== 'placeholder';
  }) ?? ids[0] ?? null;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
