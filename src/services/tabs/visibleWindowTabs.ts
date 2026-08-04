/**
 * Imperative visible-tab projection (WI-8.1/4R/12.1; extracted from
 * hooks/useVisibleWindowTabs in the WI-10 hooks→services migration).
 *
 * Purpose: THE projection every non-React tab listing consumes — the active
 * instance's document tabs plus ALL browser tabs (window-global, plan D1),
 * via the pure ownership kernel. Rail off returns the raw window list
 * unchanged (byte-identical pre-rail behavior).
 *
 * Data-level consumers (autosave, save-all, dirty sweeps, FS watching,
 * hot exit) must NOT use `visibleWindowTabs` — they see every tab through
 * `allWindowTabs` so hidden dirty documents stay protected.
 *
 * @coordinates-with services/workspaces/workspaceOwnershipKernel.ts — the rule
 * @coordinates-with hooks/useVisibleWindowTabs.ts — the reactive twin
 * @coordinates-with services/commands/tabCommands.ts — cycling consumer
 * @module services/tabs/visibleWindowTabs
 */
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { visibleTabsForWindow } from "@/services/workspaces/workspaceOwnershipKernel";
import { orderedWindowInstances } from "@/services/workspaces/workspaceContextOwnership";

/** Shared empty-array instance so reactive selectors keep referential equality. */
export const EMPTY_TABS: Tab[] = [];

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
