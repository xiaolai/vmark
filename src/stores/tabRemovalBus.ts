/**
 * Tab-removal pub/sub (#1081).
 *
 * `tabStore.closeTab` / `detachTab` are the single choke point for a tab leaving
 * a window. They call `notifyTabRemoved` after the removal; `paneStore`
 * subscribes via `onTabRemoved` to collapse a split whose pane held the tab.
 *
 * This lives in its own leaf module (imported by both stores) so tabStore never
 * imports paneStore — dependency-cruiser forbids store cycles.
 *
 * @coordinates-with stores/tabStore.ts — emits on close/detach
 * @coordinates-with stores/paneStore.ts — subscribes to collapse a split
 * @module stores/tabRemovalBus
 */

type TabRemovedListener = (windowLabel: string, tabId: string) => void;

const listeners = new Set<TabRemovedListener>();

/** Subscribe to tab removal (close/detach). Returns an unsubscribe function. */
export function onTabRemoved(listener: TabRemovedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fire all listeners for a removed tab (called by tabStore after removal). */
export function notifyTabRemoved(windowLabel: string, tabId: string): void {
  for (const listener of listeners) listener(windowLabel, tabId);
}
