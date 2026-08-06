/**
 * Context-aware closed-tab reopen (WI-11.2 / plan D4).
 *
 * Purpose: the Cmd+Shift+T behavior for the workspace-rail world. Compares the
 * ACTIVE context's newest closed document with the window-global browser
 * history's newest entry (by close sequence) and reopens the newer one:
 *   - rail on  → the active instance's scope + BROWSER_SCOPE
 *   - rail off → WINDOW_ALL_SCOPE + BROWSER_SCOPE
 *
 * A closed document whose path is already live in the window is SKIPPED
 * (dropped from history and the next candidate tried) rather than duplicated
 * or stolen from its current tab. Activation is pane-aware through
 * `setActiveTab` itself (WI-2 seam, ADR-1): under a split a reopened document
 * lands in the focused pane; browser tabs activate in place.
 *
 * @coordinates-with stores/tabStoreClosedScopes.ts — scoped history
 * @coordinates-with stores/tabActivationBus.ts — setActiveTab is pane-aware (WI-2)
 * @module services/workspaces/reopenClosedTab
 */
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  WINDOW_ALL_SCOPE,
  useClosedTabScopesStore,
} from "@/stores/tabStoreClosedScopes";
import { BROWSER_SCOPE } from "@/services/workspaces/workspaceOwnershipKernel";

function candidateScopes(windowLabel: string): string[] {
  const railEnabled = useSettingsStore.getState().general?.workspaceRailMode ?? false;
  if (!railEnabled) return [WINDOW_ALL_SCOPE, BROWSER_SCOPE];
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  // WINDOW_ALL_SCOPE stays a candidate: tabs closed before any instance
  // existed (or with no owner) should still be reopenable.
  return activeId
    ? [activeId, WINDOW_ALL_SCOPE, BROWSER_SCOPE]
    : [WINDOW_ALL_SCOPE, BROWSER_SCOPE];
}

/** True when reopening this closed document would duplicate a live path. */
function isPathAlreadyLive(windowLabel: string, tab: Tab): boolean {
  if (tab.kind !== "document" || !tab.filePath) return false;
  return useTabStore.getState().findTabByPath(windowLabel, tab.filePath) !== null;
}

/**
 * Reopen the newest closed tab of the window's ACTIVE context. Returns the
 * reopened tab, or null when every candidate history is empty.
 */
export function reopenClosedTabForActiveContext(windowLabel: string): Tab | null {
  const scopes = useClosedTabScopesStore.getState();
  const keys = candidateScopes(windowLabel);

  for (;;) {
    const newest = scopes.newestEntry(windowLabel, keys);
    if (!newest) return null;

    const tab = scopes.takeClosedTab(windowLabel, newest.scopeKey, newest.entry.tab.id);
    if (!tab) return null; // raced away — nothing sane to do

    if (isPathAlreadyLive(windowLabel, tab)) {
      // Skipped, not duplicated or stolen (D4) — try the next candidate.
      continue;
    }

    useTabStore.getState().restoreTab(windowLabel, tab);
    useTabStore.getState().setActiveTab(windowLabel, tab.id); // pane-aware (WI-2)
    return tab;
  }
}
