/**
 * Toggle the two-documents side-by-side split for a window (#1081).
 * Shared by the `view.toggleSplitDocuments` command and the keyboard shortcut
 * so they can't drift. Opening seeds the secondary pane with the current
 * document; closing collapses back to a single pane.
 *
 * @coordinates-with stores/paneStore.ts — split state
 * @coordinates-with services/navigation/activeDocument.ts — current tab
 * @module services/navigation/toggleSplitDocuments
 */
import { usePaneStore } from "@/stores/paneStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";

export function toggleSplitDocuments(windowLabel: string): void {
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (split?.enabled) {
    usePaneStore.getState().closeSplit(windowLabel);
    return;
  }
  // Nothing to split when the window has no active document (e.g. the empty
  // Welcome screen) — opening a split with a null pane is meaningless.
  const activeTabId = getActiveTabId(windowLabel);
  if (!activeTabId) return;
  usePaneStore.getState().openSplit(windowLabel, activeTabId);
}
