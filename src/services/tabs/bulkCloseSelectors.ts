/**
 * Which tabs each bulk-close action targets (WI-DSPL1.5 extraction).
 *
 * The four callbacks in `useTabContextMenuActions` repeated one lifecycle —
 * select ids, close with the dirty check, dismiss the menu — and differed only
 * in the SELECTION. Pulling the selection out leaves the lifecycle in one place
 * and makes each rule readable and testable on its own.
 *
 * Pinned tabs are excluded everywhere: `closeTab` refuses them, so including
 * them would silently no-op rather than close anything.
 *
 * @coordinates-with components/Tabs/useTabContextMenuActions.ts — the caller
 * @module services/tabs/bulkCloseSelectors
 */
import type { Tab } from "@/stores/tabStore";

const unpinnedIds = (tabs: readonly Tab[], keep: (t: Tab, i: number) => boolean): string[] =>
  tabs.filter((t, i) => keep(t, i) && !t.isPinned).map((t) => t.id);

/** Every unpinned tab except the one clicked. */
export const closeOthersIds = (tabs: readonly Tab[], tabId: string): string[] =>
  unpinnedIds(tabs, (t) => t.id !== tabId);

/** Every unpinned tab after the clicked one, in strip order. */
export const closeToRightIds = (tabs: readonly Tab[], tabIndex: number): string[] =>
  unpinnedIds(tabs, (_t, i) => i > tabIndex);

/** Every unpinned tab, the clicked one included. */
export const closeAllUnpinnedIds = (tabs: readonly Tab[]): string[] => unpinnedIds(tabs, () => true);
