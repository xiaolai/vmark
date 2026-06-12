/**
 * Tab cycling — pure next/previous tab selection (audit 20260612 H27).
 *
 * Purpose: Given the ordered tab list and the active tab id, return the id
 *   to activate when cycling forward/backward with wrap-around. Pure so the
 *   shortcut hook stays thin wiring.
 *
 * @coordinates-with hooks/useTabShortcuts.ts — Mod+Shift+[ / ] handlers
 * @module utils/tabCycling
 */

/** Id of the adjacent tab in the cycle, or null when cycling is meaningless. */
export function cycleTabId(
  tabIds: readonly string[],
  activeTabId: string | null,
  direction: "next" | "previous"
): string | null {
  if (tabIds.length < 2 || activeTabId === null) return null;
  const current = tabIds.indexOf(activeTabId);
  if (current === -1) return null;
  const offset = direction === "next" ? 1 : -1;
  return tabIds[(current + offset + tabIds.length) % tabIds.length];
}
