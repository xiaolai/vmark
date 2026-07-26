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
 * `closeTabsWithDirtyCheck` path the tab bar uses.
 *
 * CANCELLATION IS NOT ATOMIC, by design and by precedent. `closeTabsWithDirtyCheck`
 * closes tabs one at a time and stops at the first cancelled prompt, so
 * cancelling the third of five leaves two already closed and the workspace
 * still present. Nothing is lost silently — each closed tab got its own
 * save/discard prompt — and this is exactly how the tab bar's "Close Others"
 * already behaves, so close matches the app's existing semantics rather than
 * inventing a divergent two-phase protocol. What the cancel path DOES
 * guarantee is that the instance itself is not removed and the window is not
 * closed.
 *
 * Ownership is resolved LIVE from the tab store via `tabBelongsToWorkspace`,
 * not from `instance.tabIds`. That field can be stale or shared: its own
 * docstring notes that trusting it "let two instances both collect the same
 * tab", which for a close would mean closing another workspace's tab or
 * orphaning one of our own.
 *
 * The post-removal invariants mirror `moveWorkspaceInstanceToNewWindow`:
 * `main` always keeps at least one instance (a placeholder), and a non-main
 * window that just lost its last workspace closes itself.
 *
 * @coordinates-with workspaceTabCollection.ts — shared ownership predicate
 * @coordinates-with workspaceWindowActions.ts — same invariants, move/duplicate
 * @module services/workspaces/closeWorkspaceInstance
 */

import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { generateUUID } from "@/utils/workspaceIdentity";
import { workspaceError } from "@/utils/debug";
import { tabBelongsToWorkspace } from "./workspaceTabCollection";

export type CloseWorkspaceInstanceResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "cancelled" | "busy" };

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

/**
 * Instances with a close in flight.
 *
 * Closing awaits a save prompt, during which the menu item can be activated
 * again. Without this guard the second call sees tabs the first is already
 * closing as "closed", removes the instance and closes the window while the
 * first is still waiting on the user.
 */
const closing = new Set<string>();

/** Live owned tab ids, by the same ownership rule transfer uses. */
function ownedTabIds(windowLabel: string, workspaceInstanceId: string): string[] | null {
  const instancesState = useWorkspaceInstancesStore.getState();
  const windowState = instancesState.windows[windowLabel];
  // Membership in THIS window, not merely existence in the global map: the
  // instance may have moved to another window while the menu was open.
  if (!windowState?.workspaceInstanceIds.includes(workspaceInstanceId)) return null;
  const instance = instancesState.instances[workspaceInstanceId];
  if (!instance) return null;

  const activeInstanceId = windowState.activeWorkspaceInstanceId ?? null;
  return useTabStore
    .getState()
    .getTabsByWindow(windowLabel)
    .filter((tab) => tab.kind === "document")
    .filter((tab) => tabBelongsToWorkspace(tab, instance, activeInstanceId))
    .map((tab) => tab.id);
}

export async function closeWorkspaceInstance(
  windowLabel: string,
  workspaceInstanceId: string,
  { closeTabs }: CloseWorkspaceInstanceOptions,
): Promise<CloseWorkspaceInstanceResult> {
  if (closing.has(workspaceInstanceId)) return { ok: false, reason: "busy" };

  const tabIds = ownedTabIds(windowLabel, workspaceInstanceId);
  if (tabIds === null) return { ok: false, reason: "missing" };

  closing.add(workspaceInstanceId);
  try {
    const allClosed = await closeTabs(windowLabel, tabIds);
    if (!allClosed) {
      // Leave the instance in place. Tabs closed before the cancelled prompt
      // stay closed (see CANCELLATION above) — the guarantee is that the
      // workspace and its window survive.
      return { ok: false, reason: "cancelled" };
    }

    // Re-validate after the await: the instance may have moved or been removed
    // while the prompts were open, and the invariants below must not run
    // against a window this workspace no longer belongs to.
    if (ownedTabIds(windowLabel, workspaceInstanceId) === null) {
      return { ok: false, reason: "missing" };
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
  } finally {
    closing.delete(workspaceInstanceId);
  }
}
