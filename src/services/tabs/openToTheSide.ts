/**
 * "Open to the Side" — put a tab in the OTHER split pane (WI-DSPL1.5).
 *
 * The #1081 plan deferred this alongside the native menu item, and its absence
 * is why the split has been hard to reach: `Alt+Mod+\` splits the CURRENT
 * document, so before D9 it showed one file twice, and even after D9 it picks
 * the target for you. This is the only way to say "that one, beside this one".
 *
 * @coordinates-with stores/paneStore.ts — the split
 * @module services/tabs/openToTheSide
 */
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { visibleWindowTabs } from "@/services/tabs/visibleWindowTabs";

/** True when this tab can be shown beside the current one. */
export function canOpenToTheSide(windowLabel: string, tabId: string): boolean {
  // The VISIBLE projection, not the raw list: a tab owned by a non-active
  // workspace instance cannot be focused, so splitting onto it would show a
  // document the user has no way to reach (R6).
  const visible = visibleWindowTabs(windowLabel);
  const target = visible.find((t) => t.id === tabId);
  if (target?.kind !== "document") return false;

  // The ACTIVE tab must be a document too. Checking only the target let a
  // browser tab become `primaryTabId` — `openSplit` seeds the primary from the
  // alias — which is exactly the "browser tabs never touch panes" invariant.
  const activeId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (!activeId || activeId === tabId) return false;
  return visible.some((t) => t.id === activeId && t.kind === "document");
}

/**
 * Show `tabId` in the pane the active document is NOT in, opening a split if
 * needed. Already-paned tabs are FOCUSED rather than duplicated — a second
 * copy of one document is the A/A state D9 makes illegal.
 */
export function openToTheSide(windowLabel: string, tabId: string): void {
  if (!canOpenToTheSide(windowLabel, tabId)) return;
  const pane = usePaneStore.getState();
  const split = pane.byWindow[windowLabel];

  if (split?.enabled) {
    if (split.primaryTabId === tabId) return pane.setFocusedPane(windowLabel, "primary");
    if (split.secondaryTabId === tabId) return pane.setFocusedPane(windowLabel, "secondary");
    // Replace whichever pane is NOT focused, so the document the user is
    // looking at stays put. Atomic: two calls would announce the displaced tab
    // first, putting a document nobody chose at the MRU front.
    const otherPane = split.focusedPane === "primary" ? "secondary" : "primary";
    pane.showTabInPane(windowLabel, otherPane, tabId);
    return;
  }
  pane.openSplit(windowLabel, tabId);
}
