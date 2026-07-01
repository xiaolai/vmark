/**
 * Activate a tab in the window's FOCUSED pane (#1081).
 *
 * With a split open and the secondary pane focused, clicking a tab swaps the
 * secondary pane's document (paneStore) instead of the primary active tab
 * (tabStore). With no split, this is just `tabStore.setActiveTab` — unchanged.
 *
 * @coordinates-with stores/paneStore.ts — secondary pane tab + focus
 * @coordinates-with stores/tabStore.ts — primary active tab
 * @module services/navigation/activateTabInFocusedPane
 */
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";

export function activateTabInFocusedPane(windowLabel: string, tabId: string): void {
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (split?.enabled) {
    // Swap the focused pane's document (also mirrors into tabStore.activeTabId).
    usePaneStore.getState().setFocusedPaneTab(windowLabel, tabId);
    return;
  }
  useTabStore.getState().setActiveTab(windowLabel, tabId);
}
