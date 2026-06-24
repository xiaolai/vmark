import type { WorkspaceInstanceRecord } from "@/stores/workspaceInstancesStore";
import {
  type WorkspaceInstanceCreatedFrom,
  type WorkspaceInstanceKind,
} from "@/utils/workspaceIdentity";
import type {
  HotExitWorkspaceInstanceState,
  WindowState,
} from "./types";
import { synthesizeLegacyWindowInstances } from "./workspaceInstanceSynthesis";

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
  // Delegate to the shared synthesizer so restore and v5 migration agree.
  // Critically, this preserves legacy workspace tabs with a fallback root
  // identity instead of dropping them when the root path is unusable.
  return synthesizeLegacyWindowInstances(
    {
      windowLabel,
      activeTabId: windowState.active_tab_id,
      tabs: windowState.tabs,
    },
    legacyWorkspaceRoot,
  );
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

