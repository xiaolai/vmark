/**
 * voidAsync — adapt an async handler to a callback slot that expects `void`,
 * routing any rejection instead of dropping it.
 *
 * Tauri's `EventCallback`, the DOM's `EventListener`, and most `onX` props are
 * declared `(...) => void`. Handing them an `async` function type-checks as a
 * discarded return value, and the rejection then has nowhere to go: it becomes
 * an unhandled promise rejection with no stack pointing at the listener that
 * caused it. That is the `no-misused-promises` class, and it accounted for most
 * of this repo's remaining findings.
 *
 * The two obvious fixes are both worse. Marking the call site `void` silences
 * the rule and keeps the defect. Reindenting each handler body inside an
 * `void (async () => { … })()` wrapper churns dozens of lines of unrelated code
 * — on the quit and crash-recovery paths, at that — for no behavioural gain.
 * Wrapping the handler leaves its body untouched and gives the rejection a
 * documented destination.
 *
 * `onError` is REQUIRED, and deliberately so. An optional one would be left off
 * at exactly the sites that need it most, and the result would be
 * `.catch(() => {})` under a friendlier name — the pattern `browserUiStore`
 * already records as the reason a failed browser command showed a blank
 * viewport and no signal at all: "silence is the worst report available."
 *
 * @module utils/voidAsync
 */

/**
 * Wrap `fn` so it always returns `void`, sending any rejection to `onError`.
 *
 * Synchronous throws are routed too: the handler is invoked inside the same
 * promise chain, so a handler that throws before its first `await` is reported
 * through the same path rather than escaping to the caller — which, for an
 * event listener, means escaping to nobody.
 */
export function voidAsync<A extends unknown[]>(
  fn: (...args: A) => unknown,
  onError: (error: unknown) => void,
): (...args: A) => void {
  return (...args: A): void => {
    try {
      void Promise.resolve(fn(...args)).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
}
