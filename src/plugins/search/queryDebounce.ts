/**
 * createQueryDebounce
 *
 * Purpose: Coalesces rapid query/option updates from the FindBar so the
 * search plugin only rebuilds matches once per typing burst, while still
 * letting navigation flush a pending rebuild immediately so Enter doesn't
 * navigate stale matches.
 *
 * Lives in its own file so it can be unit-tested independently of the
 * full ProseMirror search plugin (which is harder to bring up in jsdom).
 *
 * @coordinates-with tiptap.ts — wires the controller into the store-subscribe
 * @module plugins/search/queryDebounce
 */

/** Public surface returned by `createQueryDebounce`. */
export interface QueryDebounceController {
  /** Schedule `fn` to run after `delayMs`, replacing any pending call. */
  schedule: (fn: () => void) => void;
  /**
   * If a callback is pending, cancel its timer and run it synchronously now.
   * Returns `true` when something was flushed, `false` when nothing was pending.
   * Callers use the return value to avoid double-running their work
   * (they can dispatch unconditionally only when this returned `false`).
   */
  flushIfPending: () => boolean;
  /** Cancel the pending timer (if any) without running its callback. Use on destroy. */
  cancel: () => void;
  /** Test/inspection: true while a callback is scheduled but not yet fired. */
  hasPending: () => boolean;
}

/**
 * Build a controller around a single debounced callback slot.
 *
 * Design notes:
 *   - Only one callback can be pending at a time. Subsequent `schedule` calls
 *     replace the prior callback AND restart the timer (rapid keystrokes
 *     coalesce into one rebuild).
 *   - `flushIfPending` exists so navigation (Enter, prev/next) can force the
 *     rebuild to happen first; otherwise nav would operate against a stale
 *     match list. No-op when nothing is pending so callers don't need to
 *     branch on `hasPending` themselves.
 *   - `cancel` is for component destruction — we explicitly do NOT want the
 *     pending callback to fire after the editor view is gone.
 */
export function createQueryDebounce(delayMs: number): QueryDebounceController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(fn) {
      clearTimer();
      pending = fn;
      timer = setTimeout(() => {
        timer = null;
        const callback = pending;
        pending = null;
        callback?.();
      }, delayMs);
    },
    flushIfPending() {
      if (pending === null) return false;
      clearTimer();
      const callback = pending;
      pending = null;
      callback();
      return true;
    },
    cancel() {
      clearTimer();
      pending = null;
    },
    hasPending() {
      return pending !== null;
    },
  };
}
