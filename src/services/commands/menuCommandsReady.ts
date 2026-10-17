/**
 * menuCommandsReady — the barrier the window-ready handshake waits on.
 *
 * Purpose: let `useWindowReady` announce "this window is listening" at the
 *   moment it becomes true, instead of guessing how long it takes.
 *
 * Why it exists: the handshake used to wait a fixed 100 ms. What it was
 *   waiting for is `useCommandBootstrap`'s menu mount: Tauri `listen()`
 *   calls, each an IPC round trip, behind what was then a dynamic import.
 *   Neither has an upper bound on a loaded machine, so no constant could
 *   cover them — and when the constant expired first, Rust was told the
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
 *     signal has to CARRY that. It used to fire from a
 *     `finally` with no payload, so a completely failed mount announced itself
 *     as ready and nothing downstream could tell the difference.
 *
 * @coordinates-with hooks/useCommandBootstrap.ts — signals after mountMenuCommands settles
 * @coordinates-with utils/readinessBarrier.ts — the barrier itself; the rules above are its rules
 * @coordinates-with contexts/useWindowReady.ts — waits before emitting `ready`
 * @module services/commands/menuCommandsReady
 */

import { menuError } from "@/utils/debug";
import { clampWaitBudget, createReadinessBarrier } from "@/utils/readinessBarrier";

export { clampWaitBudget };

/** One webview per window, so module scope IS window scope here. */
const barrier = createReadinessBarrier((later, first) =>
  // A DISAGREEING second call is a bug happening, so it is reported.
  // Keeping the first verdict stays right; discarding it without a
  // word left the one observable trace of a double mount — or of a retry this
  // barrier cannot honour — indistinguishable from an ordinary idempotent
  // repeat.
  menuError(
    `Menu readiness re-signalled as ${String(later)} after settling as ${String(first)}; keeping the first verdict.`,
  ),
);

/**
 * Called once the menu bridge has settled, with WHETHER it mounted.
 *
 * The outcome is the payload, not a formality: the bootstrap signals whether
 * the mount succeeded, failed, or came up incomplete, so a waiter is never
 * told "ready" over a menu that routes nowhere. The first verdict wins — one
 * mount per window means a second call is a bug, and letting a stray `true`
 * overwrite a `false` would restore exactly the silence this barrier removes.
 */
export function signalMenuCommandsMounted(mounted: boolean): void {
  barrier.signal(mounted);
}

/**
 * Resolve `true` when the menu listener is mounted, `false` if the mount
 * reported that it did not mount, or `false` if `budgetMs` elapses first.
 * Never rejects — the caller must proceed either way. The two `false` cases
 * are deliberately one value: both mean "do not assume the menu routes", which
 * is the only decision a waiter makes.
 */
export function waitForMenuCommands(budgetMs: number): Promise<boolean> {
  return barrier.wait(budgetMs);
}

/** Reset between tests. Production has one window per module instance. */
export function resetMenuCommandsForTest(): void {
  barrier.reset();
}
