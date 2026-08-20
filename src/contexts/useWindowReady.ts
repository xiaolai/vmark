/**
 * The window-ready handshake: flip the provider to ready, then tell Rust.
 *
 * Extracted from `WindowContext` because the sequence was copied at FIVE sites
 * (two transfer paths, the end of init, and two error paths) and had drifted in
 * exactly the ways duplicated lifecycle code drifts:
 *
 *   - none of them handled `emit`'s promise, so a failed notification was an
 *     unhandled rejection nobody ever saw;
 *   - none of them cleared the timer, so a window unmounted inside the delay
 *     still fired into a dead webview.
 *
 * The delay is load-bearing, not a fudge: Rust's `window.once("ready")` and the
 * children's own effects must both be registered before menu events can arrive,
 * or a `menu:open` lands before `useFileOperations` is listening for it.
 *
 * @coordinates-with WindowContext.tsx — sole consumer
 * @module contexts/useWindowReady
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { windowContextError } from "@/utils/debug";

/** Delay before notifying Rust. See the module header for why it exists. */
const READY_EVENT_DELAY_MS = 100;

/** The part of a webview window this hook needs — kept narrow so tests can fake it. */
interface ReadyTarget {
  label: string;
  emit: (event: string, payload?: unknown) => unknown;
}

export function useWindowReady(): { isReady: boolean; markReady: (w: ReadyTarget) => void } {
  const [isReady, setIsReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markReady = useCallback((w: ReadyTarget) => {
    setIsReady(true);
    timerRef.current = setTimeout(() => {
      // `Promise.resolve` wraps because `emit` is not guaranteed to return one.
      void Promise.resolve(w.emit("ready", w.label)).catch((e) =>
        windowContextError("ready emit failed:", e));
    }, READY_EVENT_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return { isReady, markReady };
}
