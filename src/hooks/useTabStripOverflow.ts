/**
 * Observe a scroll container and report which overflow affordances it owes
 * (WI-TNAV1.1).
 *
 * Purpose: keep `overflowState` fresh for the status-bar tab strip, whose
 * scrollbar is suppressed in both engines — so without an affordance, tabs
 * scroll silently out of view (F1).
 *
 * Key decisions:
 *   - **Content is observed, not just the box.** `.status-tabs` is
 *     `max-width: 60%`-capped: once capped, its box stops changing while
 *     `scrollWidth` still moves as tabs are added, removed or RENAMED. A
 *     `ResizeObserver` sees none of that, so a `MutationObserver` runs
 *     alongside it with `subtree` and `characterData` — the tab title sits
 *     three levels below the scroll region, so `childList` alone misses a
 *     rename.
 *   - **The effect has no dependency array, and re-observes only when the node
 *     actually changes.** A ref does not trigger renders, so the usual
 *     `useEffect(…, [])` with an early `if (!node) return` is permanent for the
 *     session: `StatusBarTabStrip` renders the tablist as `{showTabs && …}`
 *     while staying mounted, so hiding the status bar and showing it again
 *     leaves `ref.current` freshly non-null with no effect re-run. Comparing
 *     against the observed node keeps construction at exactly one per
 *     attachment rather than one per render.
 *   - The scroll listener is on the CONTAINER, not the window — a window
 *     listener never fires for an inner scroll region.
 *
 * @coordinates-with utils/tabStripOverflow.ts — the pure decision
 * @coordinates-with components/StatusBar/StatusBarTabStrip.tsx — the consumer
 * @module hooks/useTabStripOverflow
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { overflowState, type OverflowState } from "@/utils/tabStripOverflow";

const NONE: OverflowState = { canScrollLeft: false, canScrollRight: false };

const sameState = (a: OverflowState, b: OverflowState): boolean =>
  a.canScrollLeft === b.canScrollLeft && a.canScrollRight === b.canScrollRight;

export function useTabStripOverflow(ref: RefObject<HTMLElement | null>): OverflowState {
  const [state, setState] = useState<OverflowState>(NONE);
  const observedRef = useRef<HTMLElement | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  // No dependency array on purpose — a ref does not trigger renders, so this is
  // the only way to notice `ref.current` going null → node. It must therefore
  // NOT return a cleanup: React runs cleanups before every re-render, which
  // would tear the observers down on a render whose guard then skips rebuilding
  // them. Ownership is explicit instead, released by the unmount effect below.
  // The missing dependency array is the mechanism, not an oversight: `[ref]`
  // never changes, so the effect would not re-run on the null → node transition
  // this hook exists to catch. No update chain is possible either — `setState`
  // returns the SAME object when the value is unchanged (React bails out), and
  // once a real change re-renders, the node-identity guard early-returns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = ref.current;
    if (node === observedRef.current) return;

    disposeRef.current?.();
    disposeRef.current = null;
    observedRef.current = node;

    if (!node) {
      setState((prev) => (sameState(prev, NONE) ? prev : NONE));
      return;
    }

    const read = (): void => {
      const next = overflowState({
        scrollLeft: node.scrollLeft,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      });
      setState((prev) => (sameState(prev, next) ? prev : next));
    };

    const resize = new ResizeObserver(read);
    resize.observe(node);
    // Also observe the intrinsic-width content. The region itself is
    // `max-width`-capped, so once capped its box stops changing — but a
    // LAYOUT-only change inside it (a close button appearing on hover, a font
    // swap) moves `scrollWidth` with neither a mutation record nor a resize of
    // the region. Without this the chevrons go stale on exactly that path.
    const content = node.firstElementChild;
    if (content) resize.observe(content);
    const mutation = new MutationObserver(read);
    mutation.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener("scroll", read, { passive: true });
    read();

    disposeRef.current = () => {
      resize.disconnect();
      mutation.disconnect();
      node.removeEventListener("scroll", read);
    };
  });

  // Unmount only. Keyed empty so it cannot fire between renders.
  useEffect(
    () => () => {
      disposeRef.current?.();
      disposeRef.current = null;
      observedRef.current = null;
    },
    [],
  );

  return state;
}
