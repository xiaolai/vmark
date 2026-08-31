/**
 * finalizeInstanceRemoval — the ONE post-removal lifecycle for an instance
 * leaving its window (audit 20260831 #25/#26): close and move had grown
 * separate copies that were already drifting in which per-instance stores
 * they cleaned and how much of the successor's context they restored.
 *
 * Covers: store removal, per-scope terminal kill (the reconcile disposes the
 * PTYs — D-T6), closed-tab history cleanup, optional per-instance UI/pane
 * cleanup, the main-window placeholder / empty-window-close invariants, and —
 * when the removed instance was ACTIVE — the FULL context hydration of the
 * promoted successor (panes, active tab, sidebar root, config, terminal
 * realign), not just the terminal slice.
 *
 * @coordinates-with closeWorkspaceInstance.ts — cleanupPerInstanceUi: true
 * @coordinates-with workspaceWindowActions.ts — move; UI/pane state stays (rail-plan gap G2, deferred)
 * @module services/workspaces/finalizeInstanceRemoval
 */
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "@/stores/uiStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { generateUUID } from "@/utils/workspaceIdentity";
import { workspaceError } from "@/utils/debug";
import { hydrateWorkspaceInstanceContext } from "./hydrateWorkspaceInstanceContext";

export interface FinalizeInstanceRemovalOptions {
  /** Close cleans the per-instance UI/pane snapshots; move deliberately does
   *  NOT — the cross-window orphan that leaves behind is rail-plan gap G2,
   *  explicitly deferred there rather than silently half-fixed here. */
  cleanupPerInstanceUi: boolean;
}

/**
 * Remove `workspaceInstanceId` from `windowLabel` and run every follower.
 * Resolves once the promoted successor's context hydration settled (or
 * immediately when the removed instance was not active).
 */
export function finalizeInstanceRemoval(
  windowLabel: string,
  workspaceInstanceId: string,
  { cleanupPerInstanceUi }: FinalizeInstanceRemovalOptions,
): Promise<void> {
  const store = useWorkspaceInstancesStore.getState();
  const wasActive =
    store.windows[windowLabel]?.activeWorkspaceInstanceId === workspaceInstanceId;

  store.removeWorkspaceInstance(windowLabel, workspaceInstanceId);
  if (cleanupPerInstanceUi) {
    // WI-9.1/10.2 lifecycle: a closed instance's parallel per-instance state
    // must not linger as orphans.
    useWorkspaceInstanceUiStore.getState().removeInstanceUiState(workspaceInstanceId);
    useWorkspacePaneLayoutsStore.getState().removePaneLayout(workspaceInstanceId);
  }
  // WI-TS2.3 (D-T6): the instance's terminal sessions die with it — the store
  // removal IS the PTY kill — its lastActiveByScope slot drops with them, and
  // its closed-tab reopen history is cleaned per-instance.
  useUIStore.getState().terminalRemoveScopeSessions(workspaceInstanceId);
  useClosedTabScopesStore.getState().removeClosedScope(windowLabel, workspaceInstanceId);

  if (windowLabel === "main") {
    // main is never closed, so it must never be left with an empty rail.
    useWorkspaceInstancesStore
      .getState()
      .ensurePlaceholderInstance("main", `wsi-placeholder-${generateUUID()}`);
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

  if (!wasActive) return Promise.resolve();
  // Audit 20260831 #25: the promoted successor (ids[0], promoted with no
  // switch event) needs its FULL context — panes, active tab, sidebar root,
  // config, and the terminal realign — not only the terminal slice.
  return hydrateWorkspaceInstanceContext(windowLabel);
}
