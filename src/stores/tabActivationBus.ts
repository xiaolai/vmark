/**
 * Tab-activation pub/sub (WI-2, ADR-1 reverse reconciliation).
 *
 * tabStore announces EVERY activation — createTab, createTransferredTab,
 * setActiveTab, and the post-close/detach neighbor pick — after its state
 * write. paneStore subscribes to converge an enabled split (decision D2 in
 * .claude/tdd-guardian/decisions-20260803.md: focus FOLLOWS a tab already
 * shown in the other pane; an unpaned document lands in the focused pane;
 * browser tabs never touch panes), then DEV-asserts the ADR-1 invariant.
 * This inverts the old "route through activateTabInFocusedPane" call-site
 * convention (honored at ~5 of ~31 sites) into one seam no caller can skip.
 *
 * `tabId` is null when an activation cleared the alias (last tab closed).
 *
 * Leaf module — the same cycle-breaking shape as tabRemovalBus: imported by
 * both stores so tabStore never imports paneStore (dep-cruiser forbids store
 * cycles).
 *
 * @coordinates-with stores/tabStore.ts — emits after every activation
 * @coordinates-with stores/paneStore.ts — subscribes to converge the split
 * @module stores/tabActivationBus
 */

type TabActivatedListener = (windowLabel: string, tabId: string | null) => void;

const listeners = new Set<TabActivatedListener>();

/** Subscribe to tab activation. Returns an unsubscribe function. */
export function onTabActivated(listener: TabActivatedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fire all listeners for an activation (called by tabStore after its write). */
export function notifyTabActivated(windowLabel: string, tabId: string | null): void {
  for (const listener of listeners) listener(windowLabel, tabId);
}
