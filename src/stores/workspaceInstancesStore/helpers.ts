/**
 * Workspace Instances Store — Pure Helpers
 *
 * Purpose: Pure, store-agnostic reducer helpers for the workspace instances
 * store. Split out of workspaceInstancesStore.ts to keep that file under the
 * file-size limit. No Zustand/state ownership here — callers pass in slices.
 *
 * @coordinates-with workspaceInstancesStore.ts — consumes these helpers
 * @module stores/workspaceInstancesStore/helpers
 */

import type { WorkspaceInstanceIdentity } from "@/utils/workspaceIdentity";

export type WorkspaceInstanceRecord = WorkspaceInstanceIdentity;

export interface WindowWorkspaceState {
  windowLabel: string;
  workspaceInstanceIds: string[];
  activeWorkspaceInstanceId: string | null;
}

export const emptyWindowState = (windowLabel: string): WindowWorkspaceState => ({
  windowLabel,
  workspaceInstanceIds: [],
  activeWorkspaceInstanceId: null,
});

export function removeFromWindow(
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

export function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Pure reducer for `addWorkspaceInstance` (WI-TS0.3 pre-split). Adding a REAL
 * instance deletes any placeholder instances from the target window silently;
 * a placeholder being added never displaces anything.
 *
 * The incoming instance's OWN id is never treated as an evictable placeholder
 * (audit 20260831 #10): when a real instance reuses a placeholder's id, the
 * old flow filtered that id out of the membership list and then deleted the
 * record it had just written — leaving an active id with no membership and
 * no record.
 */
export function applyAddWorkspaceInstance(
  state: {
    instances: Record<string, WorkspaceInstanceRecord>;
    windows: Record<string, WindowWorkspaceState>;
  },
  instance: WorkspaceInstanceRecord,
): {
  instances: Record<string, WorkspaceInstanceRecord>;
  windows: Record<string, WindowWorkspaceState>;
} {
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
  const isEvictablePlaceholder = (id: string): boolean =>
    id !== instance.workspaceInstanceId &&
    state.instances[id]?.kind === "placeholder";
  const keptIds = realInstance
    ? target.workspaceInstanceIds.filter((id) => !isEvictablePlaceholder(id))
    : target.workspaceInstanceIds;
  const placeholderIds = realInstance
    ? target.workspaceInstanceIds.filter(isEvictablePlaceholder)
    : [];
  const ids = keptIds.includes(instance.workspaceInstanceId)
    ? keptIds
    : [...keptIds, instance.workspaceInstanceId];
  const nextInstances = { ...state.instances, [instance.workspaceInstanceId]: instance };
  for (const id of placeholderIds) {
    delete nextInstances[id];
  }
  windows[instance.ownerWindowLabel] = {
    ...target,
    workspaceInstanceIds: ids,
    activeWorkspaceInstanceId: ids.includes(target.activeWorkspaceInstanceId ?? "")
      ? target.activeWorkspaceInstanceId
      : instance.workspaceInstanceId,
  };

  return {
    instances: nextInstances,
    windows,
  };
}
