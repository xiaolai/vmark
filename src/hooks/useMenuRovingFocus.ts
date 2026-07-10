/**
 * useMenuRovingFocus
 *
 * Purpose: shared roving-tabindex keyboard navigation for flat context
 * menus (file explorer, image, terminal). Replaces three near-identical
 * hand-rolled implementations with one hook, so a fix to focus handling,
 * disabled-item skipping, or the Escape/Tab close policy lands everywhere
 * at once.
 *
 * Behavior:
 *   - Tracks `focusedIndex` with a roving tabindex (focused item = 0,
 *     others = -1). Disabled items are skipped by all navigation.
 *   - Seeds focus on the first enabled item when `enabled` becomes true
 *     (before paint, so the menu never renders without an active target)
 *     and resets to -1 when it becomes false.
 *   - Arrow Up/Down wrap and skip disabled; Home/End go to the first/last
 *     enabled item; Enter/Space activate the focused item (unless
 *     disabled); Escape and Tab call `onDismiss`.
 *   - Escape is owned here (not the document-level dismiss hook) so
 *     callers that restore focus on keyboard dismissal — e.g. the terminal
 *     refocusing xterm — can do so without a click-outside also refocusing.
 *     Pair with `useDismissOnOutsideOrEscape(..., { escape: false })`.
 *   - Keydown is IME-aware (composition keystrokes never navigate/close).
 *
 * @coordinates-with hooks/useDismissOnOutsideOrEscape.ts — click-outside half
 * @module hooks/useMenuRovingFocus
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { isImeKeyEvent } from "@/utils/imeGuard";

/** Minimal item shape the traversal needs — only the disabled flag matters. */
export interface RovingMenuItem {
  disabled?: boolean;
}

/** Next enabled item index in `direction`, skipping disabled items and
 *  wrapping around. Returns the same index when no other enabled item
 *  exists, or -1 for an empty list. */
export function findNextEnabled(
  items: readonly RovingMenuItem[],
  current: number,
  direction: 1 | -1,
): number {
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
export function findEdgeEnabled(items: readonly RovingMenuItem[], direction: 1 | -1): number {
  return direction === 1
    ? findNextEnabled(items, items.length - 1, 1)
    : findNextEnabled(items, 0, -1);
}

export interface UseMenuRovingFocusOptions<T extends RovingMenuItem> {
  /** Current menu items in render order. */
  items: readonly T[];
  /** Activate an enabled item (Enter/Space or click). */
  onActivate: (item: T, index: number) => void;
  /** Close the menu (Escape/Tab). Restore surface focus here if desired. */
  onDismiss: () => void;
  /** Seed focus while true; reset to -1 while false. Default true. For
   *  always-mounted singletons, pass the open flag. */
  enabled?: boolean;
}

export interface UseMenuRovingFocusResult {
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  /** Attach to the menu container's `onKeyDown`. */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Ref callback for each item button: `ref={(n) => registerItem(i, n)}`. */
  registerItem: (index: number, node: HTMLElement | null) => void;
  /** Roving props for each item button (tabIndex + focus/hover sync). */
  itemProps: (index: number) => {
    tabIndex: number;
    onFocus: () => void;
    onMouseEnter: () => void;
  };
}

export function useMenuRovingFocus<T extends RovingMenuItem>({
  items,
  onActivate,
  onDismiss,
  enabled = true,
}: UseMenuRovingFocusOptions<T>): UseMenuRovingFocusResult {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  // Seed the first enabled item on open, reset on close — before paint so
  // the menu never shows a frame without a roving target. Keyed on
  // `enabled` alone: item labels recompute every render, but focus must
  // only re-seed on the open/close transition, so `items` is intentionally
  // read from the flip-render closure rather than added to the deps.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open/close seed (#1063)
    setFocusedIndex(enabled ? findEdgeEnabled(items, 1) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Move DOM focus to the roving target before paint.
  useLayoutEffect(() => {
    if (focusedIndex < 0) return;
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isImeKeyEvent(event.nativeEvent)) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((i) => findNextEnabled(items, i, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((i) => findNextEnabled(items, i, -1));
          return;
        case "Home":
          event.preventDefault();
          setFocusedIndex(findEdgeEnabled(items, 1));
          return;
        case "End":
          event.preventDefault();
          setFocusedIndex(findEdgeEnabled(items, -1));
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
          return;
        case "Tab":
          event.preventDefault();
          onDismiss();
          return;
        case "Enter":
        case " ": {
          event.preventDefault();
          const item = items[focusedIndex];
          if (item && !item.disabled) onActivate(item, focusedIndex);
          return;
        }
      }
    },
    [items, focusedIndex, onActivate, onDismiss],
  );

  const registerItem = useCallback((index: number, node: HTMLElement | null) => {
    itemRefs.current[index] = node;
  }, []);

  const itemProps = useCallback(
    (index: number) => ({
      tabIndex: focusedIndex === index ? 0 : -1,
      onFocus: () => setFocusedIndex(index),
      onMouseEnter: () => {
        if (!items[index]?.disabled) setFocusedIndex(index);
      },
    }),
    [items, focusedIndex],
  );

  return { focusedIndex, setFocusedIndex, handleKeyDown, registerItem, itemProps };
}
