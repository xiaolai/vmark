/**
 * Safe Unlisten Helper
 *
 * Purpose: Wraps Tauri event unlisten calls to prevent unhandled promise rejections
 * that occur when components unmount before listen() resolves, or when
 * Tauri's internal listener state becomes inconsistent.
 *
 * Key decisions:
 *   - Errors are caught and logged via cleanupWarn (dev-only, no-op in production)
 *   - safeUnlistenAll returns empty array for easy ref replacement pattern
 *   - safeUnlistenAsync handles the common case of cleanup running before
 *     the listen() promise resolves
 *
 * @coordinates-with menuListenerHelper.ts — uses safeUnlisten for cleanup
 * @module utils/safeUnlisten
 */

import { cleanupWarn } from "@/utils/debug";
import { errorMessage } from "./errorMessage";

/**
 * Safely call an unlisten function, catching any errors.
 * Use this to wrap unlisten calls in cleanup functions.
 */
export function safeUnlisten(unlisten: (() => void) | null | undefined): void {
  if (!unlisten) return;
  try {
    const result: unknown = unlisten();
    // Tauri types UnlistenFn as `() => void`, but the implementation is async —
    // so a failing unlisten hands back a REJECTED PROMISE, which a synchronous
    // try/catch cannot see. Swallow it here or it surfaces as an unhandled
    // rejection, which is the very thing this module exists to prevent.
    // Observed live as `listeners[eventId].handlerId` on an inconsistent
    // registry. Deliberately not awaited: cleanup must not block unmount.
    if (isThenable(result)) {
      result.catch((error: unknown) => {
        cleanupWarn("Listener cleanup failed:", errorMessage(error));
      });
    }
  } catch (error) {
    // Errors from Tauri's internal listener cleanup are not fatal — they occur
    // when the listener was never fully registered, or was already cleaned up.
    // Logged rather than discarded: the module contract says cleanup failures
    // are reported, and a silent swallow hides a genuinely broken registry.
    cleanupWarn("Listener cleanup failed:", errorMessage(error));
  }
}

/** True for anything with a `.catch` — covers real Promises and Tauri's thenables. */
function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<unknown>).catch === "function"
  );
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
    .catch((error: unknown) => {
      cleanupWarn("Listener cleanup failed:", errorMessage(error));
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
