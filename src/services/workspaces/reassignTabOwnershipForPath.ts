/**
 * Ownership reassignment on deliberate navigation (WI-13.4, invariant 10).
 *
 * Purpose: Save As, rename, and cross-root moves change a tab's file path —
 * its workspace ownership must follow ATOMICALLY (explicit claim moves to the
 * new owner), and when the ACTIVE tab's owner changed, the visible context
 * follows too, otherwise the activeTabId alias would point at a tab the new
 * projection hides.
 *
 * `allowVisibleSwitch: false` is for MCP/AI flows (plan D10): AI-driven
 * saves reclassify ownership but never yank the human's visible workspace.
 *
 * Callers: saveToPath (Save As), applyPathReconciliation + external-change
 * renames, MCP workspaceSaveAs (with allowVisibleSwitch: false).
 *
 * @coordinates-with workspaceContextOwnership.ts — the atomic claim
 * @coordinates-with switchWorkspaceInstance.ts — the visible switch
 * @module services/workspaces/reassignTabOwnershipForPath
 */
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { claimTabForWorkspaceContext, orderedWindowInstances } from "./workspaceContextOwnership";
import { resolveIncomingActiveTab } from "./workspaceOwnershipKernel";
import { switchWorkspaceInstance } from "./switchWorkspaceInstance";

export interface ReassignTabOwnershipOptions {
  /** False for MCP/AI flows — reclassify without switching (D10). */
  allowVisibleSwitch?: boolean;
}

export interface ReassignTabOwnershipResult {
  workspaceSwitched: boolean;
  workspaceInstanceId: string | null;
}

/** The window containing `tabId`, or null. For callers without a label. */
export function windowLabelForTab(tabId: string): string | null {
  // Defensive `?? {}`: partial store mocks (and pre-init states) may lack tabs.
  for (const [label, tabs] of Object.entries(useTabStore.getState().tabs ?? {})) {
    if (tabs.some((tab) => tab.id === tabId)) return label;
  }
  return null;
}

export function reassignTabOwnershipForPath(
  windowLabel: string,
  tabId: string,
  newPath: string | null,
  options: ReassignTabOwnershipOptions = {},
): ReassignTabOwnershipResult {
  if (!isWorkspaceRailEnabled()) {
    return { workspaceSwitched: false, workspaceInstanceId: null };
  }

  const owner = claimTabForWorkspaceContext(windowLabel, tabId, newPath);
  if (!owner) return { workspaceSwitched: false, workspaceInstanceId: null };

  const allowSwitch = options.allowVisibleSwitch ?? true;
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const isActiveTab = useTabStore.getState().activeTabId[windowLabel] === tabId;

  if (allowSwitch && isActiveTab && owner.workspaceInstanceId !== activeId) {
    const switched = switchWorkspaceInstance(windowLabel, owner.workspaceInstanceId).switched;
    // The reassigned tab stays the active one after the context follows.
    // Pane-aware through setActiveTab itself (WI-2 seam, ADR-1): the incoming
    // context may have restored a split; the seam converges it.
    if (switched) {
      useTabStore.getState().setActiveTab(windowLabel, tabId);
    }
    return { workspaceSwitched: switched, workspaceInstanceId: owner.workspaceInstanceId };
  }
  if (!allowSwitch && isActiveTab && owner.workspaceInstanceId !== activeId && activeId) {
    // Audit R2-F7: the ACTIVE tab now belongs to a hidden instance and the
    // caller (MCP, D10) forbids yanking. Leaving it active would point the
    // alias at a tab the projection hides — activate the current instance's
    // best tab instead (pane-aware through the WI-2 seam).
    const activeInstance = useWorkspaceInstancesStore.getState().instances[activeId];
    if (activeInstance) {
      const liveTabs = useTabStore.getState().getTabsByWindow(windowLabel);
      const next = resolveIncomingActiveTab(
        activeInstance,
        liveTabs,
        orderedWindowInstances(windowLabel),
      );
      useTabStore.getState().setActiveTab(windowLabel, next);
    }
  }
  return { workspaceSwitched: false, workspaceInstanceId: owner.workspaceInstanceId };
}

/**
 * Apply an EXTERNAL rename to a tab: re-point tab + document at the new path
 * (clearing the missing flag) and let ownership follow the path (WI-13.4).
 */
export function applyExternalRename(
  windowLabel: string,
  tabId: string,
  newPath: string,
): void {
  useTabStore.getState().updateTabPath(tabId, newPath);
  useDocumentStore.getState().setFilePath(tabId, newPath);
  useDocumentStore.getState().clearMissing(tabId);
  reassignTabOwnershipForPath(windowLabel, tabId, newPath);
}
