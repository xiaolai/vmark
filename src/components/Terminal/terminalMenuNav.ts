/**
 * Roving-focus helpers for the terminal context menu.
 *
 * Purpose: pure index math for arrow / Home / End navigation over a flat
 * menu whose items may be disabled (Copy without a selection). Extracted
 * from TerminalContextMenu.tsx so the component stays under the file-size
 * guideline and the traversal logic is unit-testable on its own.
 *
 * @module components/Terminal/terminalMenuNav
 */

/** Minimal shape the traversal needs — only the disabled flag matters. */
export interface NavItem {
  disabled?: boolean;
}

/** Next enabled item index in `direction`, skipping disabled items and
 *  wrapping around. Returns the same index when no other enabled item
 *  exists, or -1 for an empty list. */
export function findNextEnabled(items: NavItem[], current: number, direction: 1 | -1): number {
  const total = items.length;
  if (total === 0) return -1;
  let index = current;
  for (let step = 0; step < total; step++) {
    index = (index + direction + total) % total;
    if (!items[index]?.disabled) return index;
  }
  // No other enabled item (all disabled, or `current` is the only one).
  return current;
}

/** First (direction 1) or last (direction -1) enabled item. */
export function findEdgeEnabled(items: NavItem[], direction: 1 | -1): number {
  return direction === 1
    ? findNextEnabled(items, items.length - 1, 1)
    : findNextEnabled(items, 0, -1);
}
