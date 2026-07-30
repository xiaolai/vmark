/**
 * Ownership-aware tab activation (WI-13.1/12.2 / plan D6).
 *
 * Purpose: every USER-facing "activate this tab" path (Quick Open selection,
 * recent files, content-search result clicks, file dialogs, drag/drop,
 * Finder opens) routes here. Activating a tab owned by a HIDDEN workspace
 * instance first performs the full visible switch — otherwise the activeTabId
 * alias would point at an invisible tab, breaking the pane invariant and
 * every "active document" consumer.
 *
 * Browser tabs are window-global (D1): they activate without any switch.
 * MCP/AI flows deliberately do NOT use this — they open background tabs and
 * only an explicit `workspace.switch_tab` yanks the visible context (D10,
 * WI-14).
 *
 * @coordinates-with switchWorkspaceInstance.ts — the visible switch
 * @coordinates-with stores/paneStore.ts — focused-pane activation under a split
 * @module services/workspaces/activateTabWithWorkspaceContext
 */
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { BROWSER_SCOPE, partitionWindowTabs } from "./workspaceOwnershipKernel";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import { switchWorkspaceInstance } from "./switchWorkspaceInstance";

export interface ActivateTabResult {
  activated: boolean;
  /** True when activating required switching the visible workspace. */
  workspaceSwitched: boolean;
  workspaceInstanceId: string | null;
}

/** Pane-aware activation: the focused pane owns the alias under a split. */
function activateTab(windowLabel: string, tabId: string, isDocument: boolean): void {
  const split = usePaneStore.getState().getSplit(windowLabel);
  if (split.enabled && isDocument) {
    usePaneStore.getState().setFocusedPaneTab(windowLabel, tabId);
  } else {
    useTabStore.getState().setActiveTab(windowLabel, tabId);
  }
}

/**
 * Activate `tabId`, switching the visible workspace to its owner first when
 * needed. No-op for unknown tabs.
 */
export function activateTabWithWorkspaceContext(
  windowLabel: string,
  tabId: string,
): ActivateTabResult {
  const tab = useTabStore.getState().getTabsByWindow(windowLabel).find((t) => t.id === tabId);
  if (!tab) return { activated: false, workspaceSwitched: false, workspaceInstanceId: null };

  if (!isWorkspaceRailEnabled()) {
    useTabStore.getState().setActiveTab(windowLabel, tabId);
    return { activated: true, workspaceSwitched: false, workspaceInstanceId: null };
  }

  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const { ownerOf } = partitionWindowTabs(
    useTabStore.getState().getTabsByWindow(windowLabel),
    orderedWindowInstances(windowLabel),
    activeId,
  );
  const owner = ownerOf.get(tabId);

  // Window-global (browser) and unowned tabs activate in place.
  const needsSwitch =
    owner !== undefined && owner !== BROWSER_SCOPE && owner !== activeId;

  let workspaceSwitched = false;
  if (needsSwitch) {
    workspaceSwitched = switchWorkspaceInstance(windowLabel, owner).switched;
    if (!workspaceSwitched) {
      // Audit R2-F6: the switch was declined (e.g. restore in flight) —
      // activating a hidden tab anyway would desync the alias from the
      // visible context. Report the refusal instead.
      return { activated: false, workspaceSwitched: false, workspaceInstanceId: activeId };
    }
  }
  activateTab(windowLabel, tabId, tab.kind === "document");

  return {
    activated: true,
    workspaceSwitched,
    workspaceInstanceId: needsSwitch ? owner : activeId,
  };
}
