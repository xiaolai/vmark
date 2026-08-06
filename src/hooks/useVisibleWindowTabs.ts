/**
 * Visible-tab projection for render surfaces (WI-8.1/4R/12.1).
 *
 * Purpose: the reactive twin of `services/tabs/visibleWindowTabs` — the
 * active instance's document tabs plus ALL browser tabs (window-global, plan
 * D1), via the pure ownership kernel. Rail off returns the raw window list
 * unchanged (byte-identical pre-rail behavior). Imperative consumers
 * (commands, services) use `services/tabs/visibleWindowTabs` instead.
 *
 * Data-level consumers (autosave, save-all, dirty sweeps, FS watching,
 * hot exit) must NOT use this — they see every tab through
 * `allWindowTabs` (services/tabs/visibleWindowTabs) so hidden dirty
 * documents stay protected.
 *
 * @coordinates-with services/tabs/visibleWindowTabs.ts — imperative twin, one rule
 * @coordinates-with services/workspaces/workspaceOwnershipKernel.ts — the rule
 * @coordinates-with components/Browser/useBrowserWorkspaceState.ts — consumer
 * @module hooks/useVisibleWindowTabs
 */
import { useMemo } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { visibleTabsForWindow } from "@/services/workspaces/workspaceOwnershipKernel";
import { EMPTY_TABS } from "@/services/tabs/visibleWindowTabs";

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
