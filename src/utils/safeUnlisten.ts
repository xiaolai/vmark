/**
 * Safe Unlisten Helper
 *
 * Purpose: Wraps Tauri event unlisten calls to prevent unhandled promise rejections
 * that occur when components unmount before listen() resolves, or when
 * Tauri's internal listener state becomes inconsistent.
 *
 * Key decisions:
 *   - All errors are silently caught — unlisten failures are never actionable
 *   - safeUnlistenAll returns empty array for easy ref replacement pattern
 *   - safeUnlistenAsync handles the common case of cleanup running before
 *     the listen() promise resolves
 *
 * @coordinates-with menuListenerHelper.ts — uses safeUnlisten for cleanup
 * @module utils/safeUnlisten
 */

/**
 * Safely call an unlisten function, catching any errors.
 * Use this to wrap unlisten calls in cleanup functions.
 */
export function safeUnlisten(unlisten: (() => void) | null | undefined): void {
  if (!unlisten) return;
  try {
    unlisten();
  } catch {
    // Ignore errors from Tauri's internal listener cleanup
    // These occur when the listener was never fully registered
    // or was already cleaned up
  }
}

/**
 * Safely resolve an unlisten promise and call the function.
 * Use this in cleanup functions for async listener setup.
 *
 * @example
 * const unlistenPromise = listen('event', handler);
 * return () => safeUnlistenAsync(unlistenPromise);
 */
export function safeUnlistenAsync(
  unlistenPromise: Promise<() => void> | null | undefined
): void {
  if (!unlistenPromise) return;
  unlistenPromise
    .then((unlisten) => safeUnlisten(unlisten))
    .catch(() => {
      // Ignore errors - listener may have never been registered
    });
}

/**
 * Safely call all unlisten functions in an array.
 * Use this to clean up arrays of listeners stored in refs.
 *
 * @example
 * unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
 *
 * @returns Empty array to replace the original
 */
export function safeUnlistenAll(unlistenFns: (() => void)[]): [] {
  for (const fn of unlistenFns) {
    safeUnlisten(fn);
  }
  return [];
}
