import type {
  HotExitWorkspaceInstanceState,
  SessionData,
} from './types';
import { synthesizeLegacyWindowInstances } from './workspaceInstanceSynthesis';

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
    : synthesizeLegacyWindowInstances(
        {
          windowLabel: window.window_label,
          activeTabId: window.active_tab_id,
          tabs: window.tabs ?? [],
        },
        legacyWorkspaceRoot,
      );
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

/**
 * A persisted instance is migratable as long as it is an object carrying a
 * string id. Every OTHER field is normalized defensively below, so we do not
 * require them to be present or well-typed here — a partially malformed entry
 * is repaired rather than dropped, which preserves its tabs.
 */
function isMigratableWorkspaceInstance(
  value: unknown,
): value is Partial<HotExitWorkspaceInstanceState> & { workspaceInstanceId: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { workspaceInstanceId?: unknown }).workspaceInstanceId === 'string';
}

function normalizeWorkspaceInstanceForV5(
  instance: Partial<HotExitWorkspaceInstanceState> & { workspaceInstanceId: string },
  windowLabel: string,
): HotExitWorkspaceInstanceState {
  // Normalize collections first — kind inference and the field copies below
  // both depend on these never being malformed (e.g. a non-array tabIds).
  const tabIds = uniqueStrings(instance.tabIds);
  const closedTabIds = uniqueStrings(instance.closedTabIds);
  const rootPath = typeof instance.rootPath === 'string' ? instance.rootPath : null;
  const createdFrom = typeof instance.createdFrom === 'string' ? instance.createdFrom : 'restore';

  const kind = instance.kind === 'workspace'
    || instance.kind === 'loose'
    || instance.kind === 'placeholder'
    ? instance.kind
    : inferMigratedKind(rootPath, createdFrom, tabIds.length);

  return {
    workspaceInstanceId: instance.workspaceInstanceId,
    kind,
    ownerWindowLabel: windowLabel,
    createdFrom,
    rootId: kind === 'workspace'
      ? (typeof instance.rootId === 'string' ? instance.rootId : null)
      : null,
    rootPath: kind === 'workspace' ? rootPath : null,
    displayName: kind === 'loose'
      ? 'Loose Files'
      : (typeof instance.displayName === 'string' ? instance.displayName : ''),
    tabIds,
    closedTabIds,
    activeTabId: typeof instance.activeTabId === 'string' ? instance.activeTabId : null,
    unavailableRoot: instance.unavailableRoot ?? false,
  };
}

function inferMigratedKind(
  rootPath: string | null,
  createdFrom: string,
  tabCount: number,
): 'workspace' | 'loose' | 'placeholder' {
  if (rootPath) return 'workspace';
  if (createdFrom === 'placeholder' && tabCount === 0) {
    return 'placeholder';
  }
  return 'loose';
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
