/**
 * Hot Exit Coordination
 *
 * Provides coordination between hot exit restore and other startup hooks.
 * Critical: Finder file open must wait for hot exit restore to complete
 * to prevent race conditions that could cause data loss.
 *
 * @module utils/hotExit/hotExitCoordination
 */

/** Standard timeout for startup hooks waiting on hot exit restore (ms). */
export const RESTORE_WAIT_TIMEOUT_MS = 15_000;

// Global state for restore coordination
let restoreInProgress = false;
const pendingWaiters: Array<() => void> = [];

/**
 * Check if a hot exit restore is currently in progress.
 *
 * Other startup hooks should check this and wait if true.
 */
export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

/**
 * Set the restore in progress flag.
 *
 * Called by useHotExitStartup when starting restore.
 * IMPORTANT: When ending restore, use notifyRestoreComplete() instead
 * to properly resolve all waiting callers.
 */
export function setRestoreInProgress(inProgress: boolean): void {
  restoreInProgress = inProgress;
  // When setting to false, also notify waiters to prevent deadlocks
  if (!inProgress) {
    notifyRestoreComplete();
  }
}

/**
 * Wait for hot exit restore to complete.
 *
 * Returns a promise that resolves when restore is complete (or wasn't in progress).
 *
 * @param timeoutMs - Maximum time to wait in milliseconds (default: RESTORE_WAIT_TIMEOUT_MS)
 * @returns true if restore completed, false if timed out
 */
export function waitForRestoreComplete(timeoutMs = RESTORE_WAIT_TIMEOUT_MS): Promise<boolean> {
  // If restore not in progress, resolve immediately
  if (!restoreInProgress) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    // Set up timeout — fires if restore takes too long.
    // If waiterCallback hasn't been called yet, remove it from pendingWaiters.
    const timeoutId = setTimeout(() => {
      const index = pendingWaiters.indexOf(waiterCallback);
      pendingWaiters.splice(index, 1); // index is always valid: waiter is only removed here or in waiterCallback (which clears this timeout)
      resolve(false); // Timed out
    }, timeoutMs);

    // Callback invoked when restore completes (only called once via notifyRestoreComplete)
    const waiterCallback = () => {
      clearTimeout(timeoutId);
      resolve(true);
    };

    // Add to pending waiters
    pendingWaiters.push(waiterCallback);
  });
}

/**
 * Notify that hot exit restore has completed.
 *
 * Clears the in-progress flag and resolves all pending waiters.
 */
export function notifyRestoreComplete(): void {
  restoreInProgress = false;

  // Resolve all pending waiters
  while (pendingWaiters.length > 0) {
    (pendingWaiters.shift() as () => void)();
  }
}

/**
 * Reset coordination state (for testing).
 */
export function resetCoordinationState(): void {
  restoreInProgress = false;
  pendingWaiters.length = 0;
}
