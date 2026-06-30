/**
 * useSyncPaneScroll — proportional scroll synchronization between two document
 * panes (#1081, plan Phase 5). Off unless `enabled`. Maps each pane's scroll
 * ratio (scrollTop / scrollable-height) onto the other, with an echo guard so
 * the programmatic scroll doesn't bounce back (the `isInternalChange` pattern).
 *
 * @coordinates-with stores/paneStore.ts — `syncScroll` toggle
 * @module components/Editor/DocumentSplit/useSyncPaneScroll
 */
import { useEffect, type RefObject } from "react";

/** Scrollers we know about, in priority order (source CM, then WYSIWYG). */
const SCROLLER_SELECTORS = [".cm-scroller", ".editor-content", ".ProseMirror"];

/** Find the scrollable element within a pane (or the pane itself as fallback). */
export function findPaneScroller(pane: HTMLElement | null): HTMLElement | null {
  if (!pane) return null;
  for (const sel of SCROLLER_SELECTORS) {
    const el = pane.querySelector<HTMLElement>(sel);
    if (el && el.scrollHeight > el.clientHeight) return el;
  }
  return pane;
}

/** The scrollTop `to` should adopt so its scroll ratio matches `from`. */
export function targetScrollTop(from: HTMLElement, to: HTMLElement): number {
  const fromRange = from.scrollHeight - from.clientHeight;
  const toRange = to.scrollHeight - to.clientHeight;
  if (fromRange <= 0 || toRange <= 0) return to.scrollTop;
  const ratio = from.scrollTop / fromRange;
  return ratio * toRange;
}

export function useSyncPaneScroll(
  primaryRef: RefObject<HTMLElement | null>,
  secondaryRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  // Re-attach when either pane's document changes (the scroller element is
  // recreated on tab switch, so stale listeners must be replaced).
  reattachKey: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    const a = findPaneScroller(primaryRef.current);
    const b = findPaneScroller(secondaryRef.current);
    if (!a || !b || a === b) return;

    let locked = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => () => {
      if (locked) return;
      locked = true;
      to.scrollTop = targetScrollTop(from, to);
      requestAnimationFrame(() => {
        locked = false;
      });
    };
    const onA = mirror(a, b);
    const onB = mirror(b, a);
    a.addEventListener("scroll", onA, { passive: true });
    b.addEventListener("scroll", onB, { passive: true });
    return () => {
      a.removeEventListener("scroll", onA);
      b.removeEventListener("scroll", onB);
    };
    // reattachKey intentionally in deps to re-bind on doc change.
  }, [enabled, primaryRef, secondaryRef, reattachKey]);
}
