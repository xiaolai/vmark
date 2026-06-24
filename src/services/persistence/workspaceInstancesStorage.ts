import type { WorkspaceInstancesStorageSnapshot } from "./hotExit/types";

export const WORKSPACE_INSTANCES_STORAGE_KEY = "vmark-workspace-instances:v4";

export type WorkspaceInstancesSnapshotReadResult =
  | { ok: true; snapshot: WorkspaceInstancesStorageSnapshot | null }
  | { ok: false; error: "corrupt" | "invalid" | "unavailable" };

export type WorkspaceInstancesSnapshotWriteResult =
  | { ok: true }
  | { ok: false; error: "quota" | "unavailable" };

export function readWorkspaceInstancesSnapshot(): WorkspaceInstancesSnapshotReadResult {
  try {
    const raw = localStorage.getItem(WORKSPACE_INSTANCES_STORAGE_KEY);
    if (!raw) return { ok: true, snapshot: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceInstancesStorageSnapshot(parsed)) {
      return { ok: false, error: "invalid" };
    }
    return { ok: true, snapshot: parsed };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: "corrupt" };
    return { ok: false, error: "unavailable" };
  }
}

export function writeWorkspaceInstancesSnapshot(
  snapshot: WorkspaceInstancesStorageSnapshot
): WorkspaceInstancesSnapshotWriteResult {
  try {
    localStorage.setItem(WORKSPACE_INSTANCES_STORAGE_KEY, JSON.stringify(snapshot));
    return { ok: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { ok: false, error: "quota" };
    }
    return { ok: false, error: "unavailable" };
  }
}

export function clearWorkspaceInstancesSnapshot(): void {
  try {
    localStorage.removeItem(WORKSPACE_INSTANCES_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

function isWorkspaceInstancesStorageSnapshot(
  value: unknown
): value is WorkspaceInstancesStorageSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.version === 4 &&
    Array.isArray(snapshot.windows) &&
    snapshot.windows.every(isSnapshotWindow) &&
    Array.isArray(snapshot.instances)
  );
}

function isSnapshotWindow(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const window = value as Record<string, unknown>;
  return (
    typeof window.window_label === "string" &&
    Array.isArray(window.workspace_instance_ids) &&
    window.workspace_instance_ids.every((id) => typeof id === "string") &&
    (window.active_workspace_instance_id === null ||
      typeof window.active_workspace_instance_id === "string")
  );
}
