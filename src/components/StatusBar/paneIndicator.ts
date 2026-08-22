/**
 * Which pill shows "visible in the other pane" (WI-DSPL1.1).
 *
 * F4: with a split open, `activeTabId` is the ADR-1 alias of the FOCUSED pane,
 * so the other pane's document is neither `.active` nor `aria-selected` — one
 * of two visible documents has no representation in the strip at all. That was
 * a deliberate v1 trade (audit finding M2), and this pays the bill.
 *
 * D8 — computed from `focusedPane`, NEVER from `secondaryTabId`. `openSplit`
 * focuses the secondary, so marking by position marks the pill that IS focused,
 * exactly backwards, on the very first frame of every split.
 *
 * R3 — suppressed while the browser workspace is active. Not a preference: the
 * native webview "paints ABOVE all DOM regardless of z-index"
 * (`services/browser/occlusion.ts`), so no document pane is on screen and the
 * claim would be false — including for a screen-reader user.
 *
 * @coordinates-with stores/paneStore.ts — the split
 * @module components/StatusBar/paneIndicator
 */
import type { WindowSplit } from "@/stores/paneStore";

export function paneIndicatorTabId(
  split: WindowSplit | undefined,
  browserWorkspaceActive: boolean,
): string | null {
  if (!split?.enabled) return null;
  if (browserWorkspaceActive) return null;
  const other = split.focusedPane === "primary" ? split.secondaryTabId : split.primaryTabId;
  // An empty secondary is legal (`openSplit(w, null)`) — nothing to indicate.
  if (!other) return null;
  // A/A is illegal since D9, but if one ever reaches here the focused pill
  // already carries `aria-selected`; a second marker on it would misreport.
  const focused = split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
  return other === focused ? null : other;
}
