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
 * PINNED TABS CLOSE WITH THEIR WORKSPACE. A pin protects a tab against an
 * accidental single close; closing the workspace is deliberate, and the rail
 * promises it closes the workspace's tabs. The close lifecycle refuses a
 * pinned tab and the bulk close stops at the first refusal, so passing pinned
 * ids through made one pinned tab turn Close into a silent "cancelled".
 * Unpinned tabs close first in one call; each pinned tab then closes on its
 * own with its pin lifted for that attempt and restored, in place, if its
 * save prompt is cancelled (services/tabs/closeLiftingPin).
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
 * @coordinates-with services/tabs/closeLiftingPin.ts — closing pinned tabs
 * @module services/workspaces/closeWorkspaceInstance
 */

import { useTabStore } from "@/stores/tabStore";
import { closeLiftingPin } from "@/services/tabs/closeLiftingPin";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { finalizeInstanceRemoval } from "./finalizeInstanceRemoval";
import {
  acquireInstanceOperation,
  releaseInstanceOperation,
} from "./instanceOperationLock";
import { tabBelongsToWorkspace } from "./workspaceTabCollection";

export type CloseWorkspaceInstanceResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "cancelled" | "busy" };

export interface CloseWorkspaceInstanceOptions {
  /**
   * Closes the given tabs, prompting per dirty tab, and resolves false as soon
   * as the user cancels one — i.e. `services/tabs/tabOperations`'
   * `closeTabsWithDirtyCheck`.
   *
   * INJECTED rather than imported: `services/` must not import from `hooks/`
   * (ADR-013 tiering, enforced by `pnpm lint:deps`). The caller is a component,
   * which may import both tiers.
   */
  closeTabs: (windowLabel: string, tabIds: string[]) => Promise<boolean>;
}

// Concurrency: closing awaits a save prompt, during which the menu item can
// be activated again — the second call would see tabs the first is already
// closing as "closed" and remove the instance under it. The guard is the
// SHARED per-instance operation lock (instanceOperationLock.ts, R2-14), so a
// close is also excluded against an in-flight move/duplicate of the same
// instance, not merely against another close.

/**
 * How many times the close loop re-collects tabs that appeared DURING a dirty
 * prompt before giving up with `busy` (R2-12). Each pass only closes NEWLY
 * appeared ids, so hitting the bound requires fresh tabs to keep landing in
 * this workspace across five consecutive prompt rounds — pathological churn,
 * not a user flow. Bounded so it cannot spin forever; `busy` leaves the
 * instance in place, which is the safe side.
 */
const MAX_CLOSE_CONVERGENCE_PASSES = 5;

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

/**
 * Close the given owned tabs: unpinned ones in a single `closeTabs` call (it
 * is consulted even for an empty list — its verdict is the user's answer),
 * then pinned ones right to left, each with its pin lifted for its own close.
 */
async function closeOwnedTabs(
  windowLabel: string,
  tabIds: readonly string[],
  closeTabs: CloseWorkspaceInstanceOptions["closeTabs"],
): Promise<boolean> {
  const wanted = new Set(tabIds);
  const live = useTabStore.getState().getTabsByWindow(windowLabel).filter((tab) => wanted.has(tab.id));
  const pinned = live.filter((tab) => tab.isPinned).map((tab) => tab.id);
  const unpinned = tabIds.filter((id) => !pinned.includes(id));

  if (!(await closeTabs(windowLabel, unpinned))) return false;
  for (const id of [...pinned].reverse()) {
    const closed = await closeLiftingPin(windowLabel, id, (tabId) => closeTabs(windowLabel, [tabId]));
    if (!closed) return false;
  }
  return true;
}

export async function closeWorkspaceInstance(
  windowLabel: string,
  workspaceInstanceId: string,
  { closeTabs }: CloseWorkspaceInstanceOptions,
): Promise<CloseWorkspaceInstanceResult> {
  if (!acquireInstanceOperation(workspaceInstanceId)) {
    return { ok: false, reason: "busy" };
  }
  try {
    const tabIds = ownedTabIds(windowLabel, workspaceInstanceId);
    if (tabIds === null) return { ok: false, reason: "missing" };

    // Tabs can be OPENED into (or reassigned to) this
    // workspace while a dirty prompt is up, and removing the instance after a
    // stale snapshot would orphan them. After each pass, re-collect and close
    // any ids that NEWLY appeared — ids already handed to the injected closer
    // are its responsibility (the pre-existing contract), so only fresh ones
    // loop. Bounded so pathological churn cannot spin forever; closeTabs is
    // always consulted at least once, empty list included — its verdict is
    // the user's answer.
    const attempted = new Set<string>();
    let toClose: string[] = tabIds;
    let freshRemaining = false;
    for (let attempt = 0; attempt < MAX_CLOSE_CONVERGENCE_PASSES; attempt++) {
      for (const id of toClose) attempted.add(id);
      const allClosed = await closeOwnedTabs(windowLabel, toClose, closeTabs);
      if (!allClosed) {
        // Leave the instance in place. Tabs closed before the cancelled
        // prompt stay closed (see CANCELLATION above) — the guarantee is that
        // the workspace and its window survive.
        return { ok: false, reason: "cancelled" };
      }
      // Re-validate after the await: the instance may have moved or been
      // removed while the prompts were open.
      const recollected = ownedTabIds(windowLabel, workspaceInstanceId);
      if (recollected === null) return { ok: false, reason: "missing" };
      const fresh = recollected.filter((id) => !attempted.has(id));
      freshRemaining = fresh.length > 0;
      if (!freshRemaining) break;
      toClose = fresh;
    }
    if (freshRemaining) return { ok: false, reason: "busy" };

    // The shared post-removal lifecycle: store removal,
    // per-instance UI/pane cleanup, terminal + closed-history cleanup, the
    // placeholder/empty-window invariants, and FULL successor hydration when
    // the closed instance was active.
    await finalizeInstanceRemoval(windowLabel, workspaceInstanceId, {
      cleanupPerInstanceUi: true,
    });

    return { ok: true };
  } finally {
    releaseInstanceOperation(workspaceInstanceId);
  }
}
