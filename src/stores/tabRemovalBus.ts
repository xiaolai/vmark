/**
 * Tab-removal pub/sub (#1081, WI-11.1).
 *
 * `tabStore.closeTab` / `detachTab` are the single choke point for a tab leaving
 * a window. They call `notifyTabRemoved` after the removal; subscribers react:
 * `paneStore` collapses a split whose pane held the tab, the per-instance UI
 * and pane-layout stores prune orphaned state, and `tabStoreClosedScopes`
 * records CLOSED (not detached) tabs into the scoped reopen history.
 *
 * WI-11.1 extended the event with an optional `info` payload carrying the
 * removed tab and the removal reason — `close` (user closed it; reopenable)
 * vs `detach` (moved to another window; NOT reopen history). Listeners that
 * only care about the removal itself ignore the third argument.
 *
 * This lives in its own leaf module (imported by both stores) so tabStore never
 * imports paneStore — dependency-cruiser forbids store cycles.
 *
 * @coordinates-with stores/tabStore.ts — emits on close/detach
 * @coordinates-with stores/paneStore.ts — subscribes to collapse a split
 * @coordinates-with stores/tabStoreClosedScopes.ts — subscribes for reopen history
 * @coordinates-with stores/workspaceInstanceUiStore.ts — outline-state cleanup
 * @coordinates-with stores/workspacePaneLayoutsStore.ts — hidden-pane pruning
 * @module stores/tabRemovalBus
 */
import type { Tab } from "@/stores/tabStoreTypes";

type TabRemovalReason = "close" | "detach";

export interface TabRemovalInfo {
  tab: Tab;
  reason: TabRemovalReason;
}

type TabRemovedListener = (
  windowLabel: string,
  tabId: string,
  info?: TabRemovalInfo,
) => void;

const listeners = new Set<TabRemovedListener>();

/** Subscribe to tab removal (close/detach). Returns an unsubscribe function. */
export function onTabRemoved(listener: TabRemovedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fire all listeners for a removed tab (called by tabStore after removal). */
export function notifyTabRemoved(
  windowLabel: string,
  tabId: string,
  info?: TabRemovalInfo,
): void {
  for (const listener of listeners) listener(windowLabel, tabId, info);
}
