import { useCallback, useRef, useState } from "react";

type CallbackRef<T extends HTMLElement> = (node: T | null) => void;

function clampHeight(rawHeight: number): number {
  // react-window breaks with height=0; also guard sub-pixel heights.
  return Math.max(1, Math.floor(rawHeight));
}

/**
 * The CONTENT-box height of an element, derived from `clientHeight` (which
 * excludes borders and scrollbars but INCLUDES padding).
 */
function contentBoxHeightOf(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const padding =
    (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  return el.clientHeight - padding;
}

/**
 * The CONTENT-box height of a resize entry.
 *
 * Two constraints, and missing either one has already shipped a bug.
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
 * They must also agree on the CONTENT box specifically. The caller feeds this
 * number to `<Tree height>`, and react-arborist stamps it onto an element
 * nested INSIDE the measured one — which is laid out in its content box, not
 * its border box. Converging both paths on the border box therefore made every
 * measurement 8px too tall, so `.file-explorer-tree` overflowed itself by
 * exactly its own padding and grew a second, redundant vertical scrollbar next
 * to react-window's real one.
 *
 * `contentBoxSize` is preferred because it needs no forced layout; older WebKit
 * exposes it as a bare object rather than the spec's array.
 */
function measuredHeightOf(entry: ResizeObserverEntry, el: HTMLElement): number {
  const raw = entry.contentBoxSize as
    | readonly ResizeObserverSize[]
    | ResizeObserverSize
    | undefined;
  const size = Array.isArray(raw) ? raw[0] : (raw as ResizeObserverSize | undefined);
  if (size) return size.blockSize;
  return entry.contentRect?.height ?? contentBoxHeightOf(el);
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
    // Must read the same box the observer path reports — see measuredHeightOf.
    setHeight(clampHeight(contentBoxHeightOf(el)));

    if (typeof ResizeObserver === "undefined") {
      // jsdom/older WebKit: best-effort measurement without observation.
      return;
    }

    // Avoid attaching multiple observers if React calls the ref repeatedly with the same node.
    if (observerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const height = entry ? measuredHeightOf(entry, el) : contentBoxHeightOf(el);
      setHeight(clampHeight(height));
    });

    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return [callbackRef, height];
}

