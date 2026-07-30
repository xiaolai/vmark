/**
 * Visible-tab projection for render surfaces (WI-8.1/4R/12.1).
 *
 * Purpose: THE projection every user-facing tab listing consumes — the
 * active instance's document tabs plus ALL browser tabs (window-global, plan
 * D1), via the pure ownership kernel. Rail off returns the raw window list
 * unchanged (byte-identical pre-rail behavior).
 *
 * Data-level consumers (autosave, save-all, dirty sweeps, FS watching,
 * hot exit) must NOT use this — they see every tab through
 * `allWindowTabs` so hidden dirty documents stay protected.
 *
 * @coordinates-with services/workspaces/workspaceOwnershipKernel.ts — the rule
 * @coordinates-with components/Browser/useBrowserWorkspaceState.ts — consumer
 * @coordinates-with hooks/tabCommands.ts — cycling consumer
 * @module hooks/useVisibleWindowTabs
 */
import { useMemo } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { visibleTabsForWindow } from "@/services/workspaces/workspaceOwnershipKernel";
import { orderedWindowInstances } from "@/services/workspaces/workspaceContextOwnership";

const EMPTY_TABS: Tab[] = [];

/** Imperative projection for non-React consumers (commands, services). */
export function visibleWindowTabs(windowLabel: string): Tab[] {
  const railEnabled = useSettingsStore.getState().general?.workspaceRailMode ?? false;
  // Defensive `?? {}`: partial store mocks (and pre-init states) may lack tabs.
  const tabs = (useTabStore.getState().tabs ?? {})[windowLabel] ?? EMPTY_TABS;
  if (!railEnabled) return tabs;
  const activeId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  return visibleTabsForWindow(tabs, orderedWindowInstances(windowLabel), activeId, true);
}

/** Every tab of the window — the operational (data-level) view, named so a
 *  reviewer can tell an intentional full read from a missed projection. */
export function allWindowTabs(windowLabel: string): Tab[] {
  return (useTabStore.getState().tabs ?? {})[windowLabel] ?? EMPTY_TABS;
}

/** Reactive projection of the window's VISIBLE tabs. */
export function useVisibleWindowTabs(windowLabel: string): Tab[] {
  const railEnabled = useSettingsStore((s) => s.general?.workspaceRailMode ?? false);
  const tabs = useTabStore((s) => (s.tabs ?? {})[windowLabel] ?? EMPTY_TABS);
  const activeInstanceId = useWorkspaceInstancesStore(
    (s) => s.windows[windowLabel]?.activeWorkspaceInstanceId ?? null,
  );
  const instanceIds = useWorkspaceInstancesStore(
    (s) => s.windows[windowLabel]?.workspaceInstanceIds,
  );
  const instances = useWorkspaceInstancesStore((s) => s.instances);

  return useMemo(() => {
    if (!railEnabled) return tabs;
    const ordered = (instanceIds ?? [])
      .map((id) => instances[id])
      .filter((instance): instance is NonNullable<typeof instance> => Boolean(instance));
    return visibleTabsForWindow(tabs, ordered, activeInstanceId, true);
  }, [railEnabled, tabs, instanceIds, instances, activeInstanceId]);
}
