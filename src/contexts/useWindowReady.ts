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
 * A document window waits for FACTS, not a duration. Two of them, because Rust
 * acts on `ready` in two ways: it starts sending menu events, and it starts
 * sending close and quit requests. `useCommandBootstrap` signals once the
 * menu listeners are actually mounted — IPC round trips that the 100 ms
 * constant this replaced could not bound — and `useWindowClose` signals once
 * its close and quit listeners
 * are registered. Announcing on the first alone left a gap in which a quit
 * request, sent once, reached no listener. Each wait is budgeted and its
 * expiry is logged, so a barrier that never signals degrades to the old
 * behaviour instead of hanging the window forever.
 *
 * That same moment is the only honest answer to "is this app drivable yet?", so
 * it is PUBLISHED to the DOM as well as to Rust — see {@link READY_ATTRIBUTE}.
 * And it is when the document surface may mount: a document window ARMS
 * `windowListening` as it starts waiting, and the announcement opens it, so
 * building a document's view cannot starve the listeners being waited on.
 *
 * @coordinates-with WindowContext.tsx — sole consumer
 * @coordinates-with services/commands/menuCommandsReady.ts — the menu-listener barrier a document window waits on
 * @coordinates-with services/windowClose/closeListenersReady.ts — the close/quit-listener barrier it also waits on
 * @coordinates-with e2e/lib/readiness.mjs — the automation harness reads the attribute
 * @coordinates-with contexts/windowListening.ts — the document surface's gate, opened on announcing
 * @module contexts/useWindowReady
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { windowContextError } from "@/utils/debug";
import { isDocumentWindowLabel } from "@/utils/windowLabels";
import { waitForMenuCommands } from "@/services/commands/menuCommandsReady";
import { waitForCloseListeners } from "@/services/windowClose/closeListenersReady";
import { armWindowListening, publishWindowListening } from "./windowListening";

/**
 * How long a document window will wait for its menu listener before giving up
 * and announcing itself anyway. An expiry is logged, never silent — see
 * `menuCommandsReady` for why the wait exists and why it must not hang.
 */
const MENU_COMMANDS_BUDGET_MS = 5_000;

/**
 * The same budget for the close and quit listeners. They are three `listen()`
 * round-trips with nothing to fetch, so in practice they are in place long
 * before the menu listener; the budget is for the case where one never is.
 */
const CLOSE_LISTENERS_BUDGET_MS = 5_000;

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
  // The window a no-barrier announcement is scheduled for, kept so a StrictMode
  // replay can schedule it again after the simulated unmount cleared the timer.
  const timerTargetRef = useRef<ReadyTarget | null>(null);
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
      // permanent hang for anything gating on it.
      void Promise.resolve(w.emit("ready", w.label)).catch((e) =>
        windowContextError("ready emit failed:", e));
    } catch (e) {
      windowContextError("ready emit failed:", e);
    } finally {
      // Published even if that emit fails, and deliberately: the attribute
      // reports what this window has finished doing — mounting its listeners
      // — not whether Rust acknowledged it.
      document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
      publishWindowListening();
    }
  }, []);

  const markReady = useCallback((w: ReadyTarget) => {
    // Before the render `setIsReady` causes, so a document window's surface
    // is held from its very first render.
    if (isDocumentWindowLabel(w.label)) armWindowListening();
    setIsReady(true);
    // Idempotent by construction. The timer version overwrote `timerRef` and
    // left the previous timer ORPHANED — still scheduled, still firing,
    // emitting `ready` a second time into a webview cleanup believed it had
    // disarmed. `markReady` is reached from five call
    // sites including two error paths, so a second call is a real shape; the
    // latch below makes the whole announcement run at most once.
    if (announcingRef.current) return;
    announcingRef.current = true;

    if (!isDocumentWindowLabel(w.label)) {
      timerTargetRef.current = w;
      timerRef.current = setTimeout(() => announce(w), NO_BARRIER_DELAY_MS);
      return;
    }

    // Both waits run together: the announcement goes out when the later of
    // the two facts is true, not after the sum of two budgets.
    void Promise.all([
      waitForMenuCommands(MENU_COMMANDS_BUDGET_MS),
      waitForCloseListeners(CLOSE_LISTENERS_BUDGET_MS),
    ]).then(([menuMounted, closeListening]) => {
      // Loud, because the window is about to claim something it could not
      // confirm. Silent expiry here would look exactly like success.
      if (!menuMounted) {
        windowContextError(
          `menu commands did not mount within ${MENU_COMMANDS_BUDGET_MS}ms; announcing ready anyway`,
        );
      }
      if (!closeListening) {
        windowContextError(
          `close listeners did not register within ${CLOSE_LISTENERS_BUDGET_MS}ms; announcing ready anyway — a quit or close request can be lost`,
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
    //
    // A cleared no-barrier timer is scheduled again here, not by a second
    // markReady: the provider's init is once-only, so in a settings or
    // pdf-export window the replay never calls markReady, and the window
    // never announced itself in dev builds.
    unmountedRef.current = false;
    if (!announcedRef.current) {
      announcingRef.current = false;
      const target = timerTargetRef.current;
      if (target && timerRef.current === null) {
        announcingRef.current = true;
        timerRef.current = setTimeout(() => announce(target), NO_BARRIER_DELAY_MS);
      }
    }
    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [announce]);

  return { isReady, markReady };
}
