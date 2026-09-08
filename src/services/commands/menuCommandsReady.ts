/**
 * menuCommandsReady — the barrier the window-ready handshake waits on.
 *
 * Purpose: let `useWindowReady` announce "this window is listening" at the
 *   moment it becomes true, instead of guessing how long it takes.
 *
 * Why it exists: the handshake used to wait a fixed 100 ms. What it was
 *   waiting for is `useCommandBootstrap`, which `await`s a dynamic import
 *   (`registerPandocFormatCommands`) and only then mounts the single Tauri
 *   menu listener. A dynamic chunk fetch has no upper bound, so no constant
 *   could cover it — and when the constant expired first, Rust was told the
 *   window was ready and the next `menu:open` went to a listener that did not
 *   exist. The delay made that rare on a warm machine and did nothing at all
 *   on a cold or loaded one.
 *
 * Key decisions:
 *   - One-shot and LEVEL-triggered, not edge-triggered: a waiter arriving
 *     after the signal resolves immediately. The two orderings are both real
 *     — the bootstrap effect can finish before the provider waits — and an
 *     edge-triggered latch would hang the handshake in one of them.
 *   - The wait is BUDGETED and resolves `false` rather than rejecting or
 *     hanging. A window that never announces itself is unusable; one that
 *     announces itself early is, at worst, the behaviour we already had.
 *   - The mount signals whether it succeeded, and the window announces itself
 *     either way. A mount that threw will never become mounted, and hanging
 *     the handshake on it would turn dead menus into a dead window — but the
 *     signal has to CARRY that (audit #359, round 3). It used to fire from a
 *     `finally` with no payload, so a completely failed mount announced itself
 *     as ready and nothing downstream could tell the difference.
 *
 * @coordinates-with hooks/useCommandBootstrap.ts — signals after mountMenuCommands settles
 * @coordinates-with contexts/useWindowReady.ts — waits before emitting `ready`
 * @module services/commands/menuCommandsReady
 */

import { menuError } from "@/utils/debug";

/** One webview per window, so module scope IS window scope here. */
let settled = false;
/** The outcome the mount reported — meaningful only once `settled`. */
let outcome = false;
let waiters: Array<(signalled: boolean) => void> = [];

/**
 * Called once the menu bridge has settled, with WHETHER it mounted (#359).
 *
 * The outcome is the payload, not a formality: the bootstrap signals whether
 * the mount succeeded, failed, or came up incomplete, so a waiter is never
 * told "ready" over a menu that routes nowhere. The first verdict wins — one
 * mount per window means a second call is a bug, and letting a stray `true`
 * overwrite a `false` would restore exactly the silence this barrier removes.
 */
export function signalMenuCommandsMounted(mounted: boolean): void {
  if (settled) {
    // A DISAGREEING second call is that bug happening, so it is reported
    // (audit #909). Keeping the first verdict stays right; discarding it
    // without a word left the one observable trace of a double mount — or of
    // a retry this barrier cannot honour — indistinguishable from an
    // ordinary idempotent repeat.
    if (mounted !== outcome) {
      menuError(
        `Menu readiness re-signalled as ${String(mounted)} after settling as ${String(outcome)}; keeping the first verdict.`,
      );
    }
    return;
  }
  settled = true;
  outcome = mounted;
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(mounted);
}

/**
 * The largest delay `setTimeout` can hold: it stores the delay in a SIGNED
 * 32-bit integer, so anything above this overflows and the timer fires
 * IMMEDIATELY — the exact opposite of "wait longer". A negative delay fires
 * immediately too.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Bring a budget inside what `setTimeout` can actually honour (audit #910).
 *
 * The failure this prevents is silent and inverted: a caller asking for a huge
 * budget got a barrier that expired on the next tick and announced the window
 * as not-ready, which is exactly the "guessing how long it takes" this module
 * exists to remove. Clamping high means "effectively never", which is what such
 * a caller means; NaN clamps to 0, the documented degraded case ("one that
 * announces itself early is, at worst, the behaviour we already had"), because
 * a 24-day wait for a nonsense argument would hang the handshake instead.
 */
export function clampWaitBudget(budgetMs: number): number {
  if (Number.isNaN(budgetMs)) return 0;
  return Math.min(Math.max(budgetMs, 0), MAX_TIMEOUT_MS);
}

/**
 * Resolve `true` when the menu listener is mounted, `false` if the mount
 * reported that it did not mount, or `false` if `budgetMs` elapses first.
 * Never rejects — the caller must proceed either way. The two `false` cases
 * are deliberately one value: both mean "do not assume the menu routes", which
 * is the only decision a waiter makes.
 */
export function waitForMenuCommands(budgetMs: number): Promise<boolean> {
  if (settled) return Promise.resolve(outcome);
  const budget = clampWaitBudget(budgetMs);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      // Drop this waiter so a later signal cannot re-resolve a settled promise
      // and cannot retain it. The verdict is about what was true when the
      // budget expired; rewriting it would make the log claim a wait succeeded
      // that did not.
      waiters = waiters.filter((w) => w !== onSignal);
      resolve(false);
    }, budget);

    const onSignal = (signalled: boolean) => {
      clearTimeout(timer);
      resolve(signalled);
    };

    waiters.push(onSignal);
  });
}

/** Reset between tests. Production has one window per module instance. */
export function resetMenuCommandsForTest(): void {
  // SETTLE the pending waiters rather than dropping them (audit #911). Each
  // waiter's `onSignal` is what clears its own `setTimeout`, so dropping the
  // list left a live timer — and an unresolved promise — running into the next
  // test, where advancing fake timers resolved a wait the reset had disowned.
  const pending = waiters;
  waiters = [];
  settled = false;
  outcome = false;
  for (const resolve of pending) resolve(false);
}
