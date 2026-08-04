/**
 * Activate a tab in the window's FOCUSED pane (#1081).
 *
 * Since WI-2, `tabStore.setActiveTab` is pane-aware by itself: every
 * activation is announced on the tabActivationBus and paneStore converges an
 * enabled split (decision D2 — focus follows a paned tab; an unpaned document
 * lands in the focused pane). This service is now a plain delegation kept for
 * its call sites' readability; the split check that used to live here is the
 * seam's job.
 *
 * @coordinates-with stores/tabActivationBus.ts — the seam that makes every activation pane-aware
 * @module services/navigation/activateTabInFocusedPane
 */
import { useTabStore } from "@/stores/tabStore";

export function activateTabInFocusedPane(windowLabel: string, tabId: string): void {
  useTabStore.getState().setActiveTab(windowLabel, tabId);
}
