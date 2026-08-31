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
 * A document window waits for a FACT, not a duration: `useCommandBootstrap`
 * signals once the single Tauri menu listener is actually mounted. It gets
 * there via an `await`ed dynamic import, so the 100 ms constant this replaced
 * could not bound it — when the constant expired first, Rust was told the
 * window was listening and the next `menu:open` went nowhere. The wait is
 * budgeted and its expiry is logged, so a barrier that never signals degrades
 * to the old behaviour instead of hanging the window forever.
 *
 * That same moment is the only honest answer to "is this app drivable yet?", so
 * it is PUBLISHED to the DOM as well as to Rust — see {@link READY_ATTRIBUTE}.
 *
 * @coordinates-with WindowContext.tsx — sole consumer
 * @coordinates-with services/commands/menuCommandsReady.ts — the barrier a document window waits on
 * @coordinates-with e2e/lib/readiness.mjs — the automation harness reads the attribute
 * @module contexts/useWindowReady
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { windowContextError } from "@/utils/debug";
import { isDocumentWindowLabel } from "@/utils/windowLabels";
import { waitForMenuCommands } from "@/services/commands/menuCommandsReady";

/**
 * How long a document window will wait for its menu listener before giving up
 * and announcing itself anyway. An expiry is logged, never silent — see
 * `menuCommandsReady` for why the wait exists and why it must not hang.
 */
const MENU_COMMANDS_BUDGET_MS = 5_000;

/**
 * Delay for a window that mounts no menu listener — settings, pdf-export.
 * Still a guess, and deliberately still 100 ms: those windows have no barrier
 * to wait on, no menu bindings to miss, and no reported defect here. Do not
 * generalise this number back over document windows; that is the mistake this
 * module just stopped making.
 */
const NO_BARRIER_DELAY_MS = 100;

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
  // Latches the announcement so five call sites cannot start five of them, and
  // records unmount so a barrier that resolves afterwards writes nothing.
  const announcingRef = useRef(false);
  const unmountedRef = useRef(false);
  // True once the announcement actually PUBLISHED (emit dispatched, attribute
  // set) — distinct from announcingRef, which only means a chain was started.
  // The StrictMode re-arm below needs the distinction: a started-but-swallowed
  // chain must be restartable, a completed one must never run twice.
  const announcedRef = useRef(false);

  const announce = useCallback((w: ReadyTarget) => {
    if (unmountedRef.current || announcedRef.current) return;
    announcedRef.current = true;
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
  }, []);

  const markReady = useCallback((w: ReadyTarget) => {
    setIsReady(true);
    // Idempotent by construction. The timer version overwrote `timerRef` and
    // left the previous timer ORPHANED — still scheduled, still firing,
    // emitting `ready` a second time into a webview cleanup believed it had
    // disarmed (audit finding #12). `markReady` is reached from five call
    // sites including two error paths, so a second call is a real shape; the
    // latch below makes the whole announcement run at most once.
    if (announcingRef.current) return;
    announcingRef.current = true;

    if (!isDocumentWindowLabel(w.label)) {
      timerRef.current = setTimeout(() => announce(w), NO_BARRIER_DELAY_MS);
      return;
    }

    void waitForMenuCommands(MENU_COMMANDS_BUDGET_MS).then((mounted) => {
      if (!mounted) {
        // Loud, because the window is about to claim something it could not
        // confirm. Silent expiry here would look exactly like success.
        windowContextError(
          `menu commands did not mount within ${MENU_COMMANDS_BUDGET_MS}ms; announcing ready anyway`,
        );
      }
      announce(w);
    });
  }, [announce]);

  useEffect(() => {
    // Re-arm on (re)mount. Dev builds run under React.StrictMode, whose
    // simulated unmount executes the cleanup below and then REMOUNTS WITH THE
    // SAME REFS — without this reset, `unmountedRef` stayed true on a live
    // window and `announce` refused forever: no `ready` emit to Rust, no DOM
    // attribute, and the tier-0 wait-ready gate hung its full 300s budget
    // (CI run 33367721596; reproduced locally on `pnpm tauri:dev`).
    // `announcingRef` is re-armed too — but only when nothing actually
    // published — so the second lifecycle's markReady can restart a chain the
    // simulated unmount swallowed, while a COMPLETED announcement stays
    // latched (announcedRef) and can never emit twice.
    unmountedRef.current = false;
    if (!announcedRef.current) announcingRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { isReady, markReady };
}
