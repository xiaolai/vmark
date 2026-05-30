/**
 * debounce
 *
 * Purpose: Generic trailing-edge debounce. Coalesces rapid calls into a single
 * invocation that runs `delayMs` after the last call, using the last-seen args.
 * Returns the wrapped function augmented with `.cancel()` and `.flush()`.
 *
 * Used as the shared primitive under the bespoke search debounce controllers
 * (`createQueryDebounce`, `createDebouncedSearchCounter`).
 *
 * @module utils/debounce
 */

/** A debounced function with imperative cancel/flush controls. */
export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  /** Clear the pending timer without invoking. No-op when nothing is pending. */
  cancel: () => void;
  /**
   * Invoke the pending call immediately with the last args and clear the timer.
   * No-op when nothing is pending.
   */
  flush: () => void;
  /** True while a call is scheduled but not yet fired. */
  pending: () => boolean;
};

/**
 * Build a trailing-edge debounced wrapper around `fn`.
 *
 * Design notes:
 *   - Only one call can be pending at a time. Subsequent invocations replace
 *     the stored args AND restart the timer, so a burst coalesces into one fire.
 *   - The pending state (timer + args) is cleared BEFORE `fn` runs, so a call
 *     that re-invokes the debounced wrapper from inside `fn` starts a fresh
 *     window rather than racing the just-fired timer.
 *   - `cancel` drops the pending call entirely; `flush` runs it now.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const invoke = (): void => {
    // Snapshot and clear pending state before calling, so re-entrant
    // scheduling from within `fn` opens a fresh window.
    const args = lastArgs as A;
    lastArgs = null;
    fn(...args);
  };

  const debounced = ((...args: A): void => {
    clearTimer();
    lastArgs = args;
    timer = setTimeout(() => {
      timer = null;
      invoke();
    }, delayMs);
  }) as Debounced<A>;

  debounced.cancel = (): void => {
    clearTimer();
    lastArgs = null;
  };

  debounced.flush = (): void => {
    if (lastArgs === null) return;
    clearTimer();
    invoke();
  };

  debounced.pending = (): boolean => lastArgs !== null;

  return debounced;
}
