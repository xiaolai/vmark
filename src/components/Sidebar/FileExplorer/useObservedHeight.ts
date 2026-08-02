import { useCallback, useRef, useState } from "react";

type CallbackRef<T extends HTMLElement> = (node: T | null) => void;

function clampHeight(rawHeight: number): number {
  // react-window breaks with height=0; also guard sub-pixel heights.
  return Math.max(1, Math.floor(rawHeight));
}

/**
 * The BORDER-box height of a resize entry — the same box
 * `getBoundingClientRect().height` reports.
 *
 * Both measurement paths MUST agree. They used to disagree: the ref path read
 * the border box while this path read `contentRect`, which is the CONTENT box.
 * `.file-explorer-tree` has 4px vertical padding, so the two differed by 8px
 * (909 vs 901) and each measurement re-triggered the other — a permanent
 * re-render loop that tore down and rebuilt every tree row ~60 times a second.
 * A real mouse click was then impossible, because the row receiving mousedown
 * was destroyed before its mouseup, so no click event was ever synthesised
 * (issue #1187).
 *
 * `borderBoxSize` is preferred because it needs no forced layout; older WebKit
 * exposes it as a bare object rather than the spec's array.
 */
function borderBoxHeightOf(entry: ResizeObserverEntry, el: HTMLElement): number {
  const raw = entry.borderBoxSize as
    | readonly ResizeObserverSize[]
    | ResizeObserverSize
    | undefined;
  const size = Array.isArray(raw) ? raw[0] : (raw as ResizeObserverSize | undefined);
  return size?.blockSize ?? el.getBoundingClientRect().height;
}

/** Hook that tracks an element's height via ResizeObserver, returning a callback ref and the measured height. */
export function useObservedHeight<T extends HTMLElement>(): [CallbackRef<T>, number] {
  const [height, setHeight] = useState(1);
  const observerRef = useRef<ResizeObserver | null>(null);
  const elRef = useRef<T | null>(null);

  const callbackRef = useCallback<CallbackRef<T>>((el) => {
    // Disconnect when unmounting or when the observed element changes.
    if (elRef.current !== el) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elRef.current = el;
    }

    if (!el) return;

    // Initialize synchronously to avoid flash before ResizeObserver fires.
    const initialRectHeight = el.getBoundingClientRect().height;
    const initialHeight = initialRectHeight > 0 ? initialRectHeight : el.clientHeight;
    setHeight(clampHeight(initialHeight));

    if (typeof ResizeObserver === "undefined") {
      // jsdom/older WebKit: best-effort measurement without observation.
      return;
    }

    // Avoid attaching multiple observers if React calls the ref repeatedly with the same node.
    if (observerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const rectHeight = entry
        ? borderBoxHeightOf(entry, el)
        : el.getBoundingClientRect().height;
      setHeight(clampHeight(rectHeight));
    });

    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return [callbackRef, height];
}

