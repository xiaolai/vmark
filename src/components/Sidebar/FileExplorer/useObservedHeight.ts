import { useCallback, useRef, useState } from "react";

type CallbackRef<T extends HTMLElement> = (node: T | null) => void;

function clampHeight(rawHeight: number): number {
  // react-window breaks with height=0; also guard sub-pixel heights.
  return Math.max(1, Math.floor(rawHeight));
}

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
      const rectHeight =
        entries[0]?.contentRect.height ?? el.getBoundingClientRect().height;
      setHeight(clampHeight(rectHeight));
    });

    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return [callbackRef, height];
}

