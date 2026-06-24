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

export function removePlaceholdersFromWindow(
  windowState: WindowWorkspaceState,
  instances: Record<string, WorkspaceInstanceRecord>,
): WindowWorkspaceState {
  const ids = windowState.workspaceInstanceIds.filter(
    (id) => instances[id]?.kind !== "placeholder",
  );
  return {
    ...windowState,
    workspaceInstanceIds: ids,
    activeWorkspaceInstanceId: ids.includes(windowState.activeWorkspaceInstanceId ?? "")
      ? windowState.activeWorkspaceInstanceId
      : ids[0] ?? null,
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
