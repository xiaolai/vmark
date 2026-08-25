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
 * That same moment is the only honest answer to "is this app drivable yet?", so
 * it is PUBLISHED to the DOM as well as to Rust — see {@link READY_ATTRIBUTE}.
 *
 * @coordinates-with WindowContext.tsx — sole consumer
 * @coordinates-with e2e/lib/readiness.mjs — the automation harness reads the attribute
 * @module contexts/useWindowReady
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { windowContextError } from "@/utils/debug";

/** Delay before notifying Rust. See the module header for why it exists. */
const READY_EVENT_DELAY_MS = 100;

/**
 * Where this window announces that its handshake is complete.
 *
 * Rust learns this from the `ready` event; nothing outside the process could,
 * and an automation harness driving the app has exactly the same question Rust
 * does — "are the frontend's listeners registered yet?". It used to have to
 * guess, and every guess was a proxy for this fact: an open TCP port, then a
 * listed window, then `execute_js` returning `1+1`. Each is true strictly
 * before this is, so each let a harness act into a window that was not
 * listening. Tier-0 CI run 32701401717 is the receipt — `vmark.workspace.new`
 * fired ~5s before the handshake, went to a listener that did not exist yet,
 * and the journey timed out on a tab that was never going to appear.
 *
 * Set AFTER the emit is dispatched, so it is never true earlier than the fact
 * it reports. Deliberately a plain attribute rather than a window global: it
 * survives in a DOM snapshot, and it cannot be read as an API worth calling.
 */
export const READY_ATTRIBUTE = "data-vmark-window-ready";

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
    // Idempotent by construction. Overwriting `timerRef` left the previous
    // timer ORPHANED — still scheduled, still firing, emitting `ready` a second
    // time and writing into a webview that cleanup believed it had disarmed
    // (audit finding #12). `markReady` is reached from five call sites
    // including two error paths, so a second call is a real shape.
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        // `Promise.resolve` wraps because `emit` is not guaranteed to return
        // one; the try/catch is for the case it does not return at all. A
        // SYNCHRONOUS throw escapes `Promise.resolve(...)` entirely, and it
        // used to take the attribute publish below down with it — leaving a
        // fully-listening window advertising itself as never ready, which is a
        // permanent hang for anything gating on it (audit finding #11).
        void Promise.resolve(w.emit("ready", w.label)).catch((e) =>
          windowContextError("ready emit failed:", e));
      } catch (e) {
        windowContextError("ready emit failed:", e);
      } finally {
        // Published even if that emit fails, and deliberately: the attribute
        // reports what this window has finished doing — mounting its listeners
        // — not whether Rust acknowledged it.
        document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
      }
    }, READY_EVENT_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return { isReady, markReady };
}
