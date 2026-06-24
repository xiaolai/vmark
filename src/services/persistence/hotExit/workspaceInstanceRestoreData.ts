import type { WorkspaceInstanceRecord } from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceRootIdentity,
  type WorkspaceInstanceCreatedFrom,
  type WorkspaceInstanceKind,
} from "@/utils/workspaceIdentity";
import { isWithinRoot } from "@/utils/paths";
import type {
  HotExitWorkspaceInstanceState,
  TabState,
  WindowState,
} from "./types";

const CREATED_FROM_VALUES = new Set<string>([
  "open",
  "finderOpen",
  "duplicate",
  "dragOut",
  "restore",
  "placeholder",
]);

export function parseWindowInstances(
  windowLabel: string,
  windowState: WindowState
): WorkspaceInstanceRecord[] {
  const rawInstances = windowState.workspace_instances;
  if (!Array.isArray(rawInstances)) return [];
  return rawInstances
    .filter(isHotExitWorkspaceInstanceState)
    .map((instance) => ({
      ...instance,
      kind: parseKind(instance.kind, instance),
      ownerWindowLabel: windowLabel,
      createdFrom: parseCreatedFrom(instance.createdFrom),
      unavailableRoot: instance.unavailableRoot ?? false,
    }));
}

export function orderedValidIds(
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

export function chooseActiveIdForRestoredInstances(
  windowState: WindowState,
  instances: WorkspaceInstanceRecord[],
  ids: string[],
): string | null {
  if (ids.includes(windowState.active_workspace_instance_id ?? "")) {
    return windowState.active_workspace_instance_id ?? null;
  }
  if (windowState.active_tab_id) {
    const containing = instances.find((instance) =>
      instance.tabIds.includes(windowState.active_tab_id!),
    );
    if (containing) return containing.workspaceInstanceId;
  }
  return ids.find((id) => {
    const instance = instances.find((candidate) => candidate.workspaceInstanceId === id);
    return instance?.kind !== "placeholder";
  }) ?? ids[0] ?? null;
}

export function synthesizeWindowInstances(
  windowLabel: string,
  windowState: WindowState,
  legacyWorkspaceRoot: string | null,
): WorkspaceInstanceRecord[] {
  if (windowState.tabs.length === 0) return [];
  const workspaceTabs: TabState[] = [];
  const looseTabs: TabState[] = [];
  for (const tab of windowState.tabs) {
    if (legacyWorkspaceRoot && tab.file_path && isWithinRoot(legacyWorkspaceRoot, tab.file_path)) {
      workspaceTabs.push(tab);
    } else {
      looseTabs.push(tab);
    }
  }

  const result: WorkspaceInstanceRecord[] = [];
  if (legacyWorkspaceRoot && workspaceTabs.length > 0) {
    const root = createWorkspaceRootIdentity(legacyWorkspaceRoot, { platform: "macos" });
    if (root.ok) {
      result.push({
        ...createWorkspaceRecord(
          `wsi-legacy-${windowLabel}-workspace`,
          "workspace",
          windowLabel,
          root.root.rootId,
          root.root.rootPath,
          root.root.displayName,
        ),
        tabIds: workspaceTabs.map((tab) => tab.id),
        activeTabId: activeTabInList(windowState.active_tab_id, workspaceTabs),
      });
    }
  }
  if (looseTabs.length > 0) {
    result.push({
      ...createWorkspaceRecord(
        `wsi-legacy-${windowLabel}-loose`,
        "loose",
        windowLabel,
        null,
        null,
        "Loose Files",
      ),
      tabIds: looseTabs.map((tab) => tab.id),
      activeTabId: activeTabInList(windowState.active_tab_id, looseTabs),
    });
  }
  return result;
}

function isHotExitWorkspaceInstanceState(
  value: unknown
): value is HotExitWorkspaceInstanceState {
  if (typeof value !== "object" || value === null) return false;
  const instance = value as Record<string, unknown>;
  return (
    typeof instance.workspaceInstanceId === "string" &&
    (
      instance.kind === undefined ||
      instance.kind === "workspace" ||
      instance.kind === "loose" ||
      instance.kind === "placeholder"
    ) &&
    (instance.rootId === null || typeof instance.rootId === "string") &&
    (instance.rootPath === null || typeof instance.rootPath === "string") &&
    typeof instance.displayName === "string" &&
    typeof instance.ownerWindowLabel === "string" &&
    typeof instance.createdFrom === "string" &&
    (instance.activeTabId === null || typeof instance.activeTabId === "string") &&
    Array.isArray(instance.tabIds) &&
    instance.tabIds.every((id) => typeof id === "string") &&
    Array.isArray(instance.closedTabIds) &&
    instance.closedTabIds.every((id) => typeof id === "string") &&
    (
      instance.unavailableRoot === undefined ||
      typeof instance.unavailableRoot === "boolean"
    )
  );
}

function parseCreatedFrom(value: string): WorkspaceInstanceCreatedFrom {
  return CREATED_FROM_VALUES.has(value)
    ? (value as WorkspaceInstanceCreatedFrom)
    : "restore";
}

function parseKind(
  value: HotExitWorkspaceInstanceState["kind"],
  instance: HotExitWorkspaceInstanceState,
): WorkspaceInstanceKind {
  if (value === "workspace" || value === "loose" || value === "placeholder") return value;
  if (instance.rootPath) return "workspace";
  if (instance.createdFrom === "placeholder" && instance.tabIds.length === 0) return "placeholder";
  return "loose";
}

function createWorkspaceRecord(
  workspaceInstanceId: string,
  kind: WorkspaceInstanceKind,
  ownerWindowLabel: string,
  rootId: string | null,
  rootPath: string | null,
  displayName: string,
): WorkspaceInstanceRecord {
  return {
    workspaceInstanceId,
    kind,
    rootId,
    rootPath,
    displayName,
    ownerWindowLabel,
    createdFrom: "restore",
    activeTabId: null,
    tabIds: [],
    closedTabIds: [],
    unavailableRoot: false,
  };
}

function activeTabInList(activeTabId: string | null, tabs: TabState[]): string | null {
  if (!activeTabId) return null;
  return tabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
}
