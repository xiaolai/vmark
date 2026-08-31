/**
 * restoreInstanceContext — the ONE pane/tab restoration for an instance
 * becoming (or re-becoming) the window's visible context (audit 20260831
 * #22): the rail-switch coordinator and the hydrate/repair path had grown
 * near-identical copies of it, and the copies had already forced hydrate to
 * import a helper out of the switch coordinator.
 *
 * @coordinates-with switchWorkspaceInstance.ts — restore-on-switch caller
 * @coordinates-with hydrateWorkspaceInstanceContext.ts — startup/repair caller
 * @module services/workspaces/restoreInstanceContext
 */
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { partitionWindowTabs, resolveIncomingActiveTab } from "./workspaceOwnershipKernel";
import { orderedWindowInstances } from "./workspaceContextOwnership";

/**
 * Audit R2-F3: a stashed split may reference tabs that were REASSIGNED to
 * another instance while hidden (Save As, rename). replaceWindowSplit only
 * checks liveness — ownership must be enforced here, through the kernel.
 */
export function sanitizeSplitForInstance(
  split: import("@/stores/paneStore").WindowSplit | null,
  instanceId: string,
  liveTabs: readonly import("@/stores/tabStore").Tab[],
  instances: readonly import("@/stores/workspaceInstancesStore").WorkspaceInstanceRecord[],
): import("@/stores/paneStore").WindowSplit | null {
  if (!split?.enabled) return split;
  const { ownerOf } = partitionWindowTabs(liveTabs, instances, instanceId);
  const owned = (tabId: string | null) =>
    tabId !== null && ownerOf.get(tabId) === instanceId ? tabId : null;
  return {
    ...split,
    primaryTabId: owned(split.primaryTabId),
    secondaryTabId: owned(split.secondaryTabId),
  };
}

/** Restore `instanceId`'s stashed panes and active tab onto the window's
 *  visible surfaces via the ONE atomic pane action. No-op for a missing
 *  record. */
export function restoreInstanceVisualContext(windowLabel: string, instanceId: string): void {
  const record = useWorkspaceInstancesStore.getState().instances[instanceId];
  if (!record) return;

  const liveTabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const instances = orderedWindowInstances(windowLabel);
  const fallbackActive = resolveIncomingActiveTab(record, liveTabs, instances);
  const stashed = useWorkspacePaneLayoutsStore.getState().getPaneLayout(instanceId);
  usePaneStore.getState().replaceWindowSplit(
    windowLabel,
    sanitizeSplitForInstance(stashed, instanceId, liveTabs, instances),
    fallbackActive,
  );
}
