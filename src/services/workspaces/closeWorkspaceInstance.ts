/**
 * Close a workspace instance from the rail.
 *
 * The rail shipped with no close affordance: the only way to remove a workspace
 * was to drag its icon outside the window, which is undiscoverable and easy to
 * trigger by accident, so instances accumulated with no way to clear them.
 *
 * `removeWorkspaceInstance` alone is NOT a close — it drops the instance from
 * the store while its tabs live on, orphaning them along with any unsaved work.
 * Closing therefore routes the workspace's tabs through the same
 * `closeTabsWithDirtyCheck` path the tab bar uses, and aborts without touching
 * the instance if the user cancels a save prompt.
 *
 * The post-removal invariants mirror `moveWorkspaceInstanceToNewWindow`:
 * `main` always keeps at least one instance (a placeholder), and a non-main
 * window that just lost its last workspace closes itself.
 *
 * @coordinates-with workspaceWindowActions.ts — same invariants, move/duplicate
 * @module services/workspaces/closeWorkspaceInstance
 */

import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { generateUUID } from "@/utils/workspaceIdentity";
import { workspaceError } from "@/utils/debug";

export type CloseWorkspaceInstanceResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "cancelled" };

export interface CloseWorkspaceInstanceOptions {
  /**
   * Closes the given tabs, prompting per dirty tab, and resolves false as soon
   * as the user cancels one — i.e. `hooks/useTabOperations`'
   * `closeTabsWithDirtyCheck`.
   *
   * INJECTED rather than imported: `services/` must not import from `hooks/`
   * (ADR-013 tiering, enforced by `pnpm lint:deps`). The caller is a component,
   * which may import both tiers — the same shape
   * `moveWorkspaceInstanceToNewWindow` uses for `cleanupTab`.
   */
  closeTabs: (windowLabel: string, tabIds: string[]) => Promise<boolean>;
}

export async function closeWorkspaceInstance(
  windowLabel: string,
  workspaceInstanceId: string,
  { closeTabs }: CloseWorkspaceInstanceOptions,
): Promise<CloseWorkspaceInstanceResult> {
  const instance =
    useWorkspaceInstancesStore.getState().instances[workspaceInstanceId];
  if (!instance) return { ok: false, reason: "missing" };

  const allClosed = await closeTabs(windowLabel, instance.tabIds);
  if (!allClosed) {
    // Leave the workspace exactly as it was — a cancelled prompt must not
    // produce a half-closed workspace whose tabs are gone but whose entry
    // remains (or the reverse).
    return { ok: false, reason: "cancelled" };
  }

  const store = useWorkspaceInstancesStore.getState();
  store.removeWorkspaceInstance(windowLabel, workspaceInstanceId);

  if (windowLabel === "main") {
    // main is never closed, so it must never be left with an empty rail.
    store.ensurePlaceholderInstance("main", `wsi-placeholder-${generateUUID()}`);
  } else if (
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.workspaceInstanceIds
      .length === 0
  ) {
    // Don't drop the rejection — a failed close should surface in logs rather
    // than become an unhandled promise rejection.
    void invoke("close_window", { label: windowLabel }).catch((error) => {
      workspaceError("Failed to close emptied window:", error);
    });
  }

  return { ok: true };
}
