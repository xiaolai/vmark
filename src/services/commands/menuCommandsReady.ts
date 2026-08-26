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
 *   - The mount signals in a `finally`, success or failure. A mount that threw
 *     will never become mounted, and hanging the handshake on it would turn
 *     dead menus into a dead window.
 *
 * @coordinates-with hooks/useCommandBootstrap.ts — signals after mountMenuCommands settles
 * @coordinates-with contexts/useWindowReady.ts — waits before emitting `ready`
 * @module services/commands/menuCommandsReady
 */

/** One webview per window, so module scope IS window scope here. */
let mounted = false;
let waiters: Array<(signalled: boolean) => void> = [];

/** Called once the menu listener is actually mounted (or has failed to mount). */
export function signalMenuCommandsMounted(): void {
  if (mounted) return;
  mounted = true;
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(true);
}

/**
 * Resolve `true` when the menu listener is mounted, or `false` if `budgetMs`
 * elapses first. Never rejects — the caller must proceed either way.
 */
export function waitForMenuCommands(budgetMs: number): Promise<boolean> {
  if (mounted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      // Drop this waiter so a later signal cannot re-resolve a settled promise
      // and cannot retain it. The verdict is about what was true when the
      // budget expired; rewriting it would make the log claim a wait succeeded
      // that did not.
      waiters = waiters.filter((w) => w !== onSignal);
      resolve(false);
    }, budgetMs);

    const onSignal = (signalled: boolean) => {
      clearTimeout(timer);
      resolve(signalled);
    };

    waiters.push(onSignal);
  });
}

/** Reset between tests. Production has one window per module instance. */
export function resetMenuCommandsForTest(): void {
  mounted = false;
  waiters = [];
}
