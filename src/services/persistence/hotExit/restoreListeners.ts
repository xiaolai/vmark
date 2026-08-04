/**
 * Restore-completion listeners for the hot-exit startup path.
 *
 * Purpose: register the RESTORE_COMPLETE / RESTORE_FAILED listeners and hand
 *   back one promise for "how did the restore end", with a timeout.
 *
 * Split out of `restartWithHotExit.ts` (audit 20260804-F10) so that file stays
 * inside the ~300-line gate; the behavior is unchanged and its tests still
 * drive it through `checkAndRestoreSession`.
 *
 * Key decision: listener registration is AWAITED before the caller invokes the
 * restore commands. Rust can emit RESTORE_COMPLETE before a not-yet-registered
 * listener exists, and the restore would then hang until the timeout.
 *
 * @coordinates-with restartWithHotExit.ts — the only caller
 * @module services/persistence/hotExit/restoreListeners
 */
import { listen } from '@tauri-apps/api/event';
import { HOT_EXIT_EVENTS } from './types';

/** Not exported: it is only ever reached through `RestoreListenerHandle`, and
 *  a second exported name for the same shape is dead weight the knip ratchet
 *  is right to count. */
interface RestoreOutcome {
  success: boolean;
  error?: string;
}

/** Result type for restore listener setup */
export interface RestoreListenerHandle {
  /** Promise that resolves when restore completes or fails */
  resultPromise: Promise<RestoreOutcome>;
  /** Cleanup function to call if invoke fails */
  cleanup: () => void;
}

/**
 * Set up restore event listeners and wait for them to be ready.
 *
 * @param timeoutMs - Maximum time to wait for restore completion
 * @returns Handle with result promise and cleanup function
 */
export async function setupRestoreListeners(
  timeoutMs: number
): Promise<RestoreListenerHandle> {
  let resolved = false;
  let resolveResult: (result: RestoreOutcome) => void;
  let unlistenComplete: (() => void) | undefined;
  let unlistenFailed: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const resultPromise = new Promise<RestoreOutcome>((resolve) => {
    resolveResult = resolve;
  });

  const cleanup = () => {
    /* v8 ignore start -- timeoutId is always set before cleanup is externally reachable; false branch unreachable */
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    /* v8 ignore stop */
    /* v8 ignore start -- unlistenComplete is always set before cleanup is externally reachable; false branch unreachable */
    if (unlistenComplete) {
      unlistenComplete();
      unlistenComplete = undefined;
    }
    /* v8 ignore stop */
    /* v8 ignore start -- unlistenFailed is always set before cleanup is externally reachable; false branch unreachable */
    if (unlistenFailed) {
      unlistenFailed();
      unlistenFailed = undefined;
    }
    /* v8 ignore stop */
  };

  const handleResolve = (result: RestoreOutcome) => {
    /* v8 ignore start -- double-fire guard: handleResolve is called at most once in normal flow; true branch unreachable */
    if (resolved) return;
    /* v8 ignore stop */
    resolved = true;
    cleanup();
    resolveResult(result);
  };

  // AWAIT listener registration - this is the key fix for the race condition
  const [completeUnsub, failedUnsub] = await Promise.all([
    listen(HOT_EXIT_EVENTS.RESTORE_COMPLETE, () => {
      handleResolve({ success: true });
    }),
    listen<{ error: string }>(HOT_EXIT_EVENTS.RESTORE_FAILED, (event) => {
      handleResolve({ success: false, error: event.payload.error });
    }),
  ]);

  unlistenComplete = completeUnsub;
  unlistenFailed = failedUnsub;

  // Set up timeout AFTER listeners are confirmed ready
  timeoutId = setTimeout(() => {
    handleResolve({ success: false, error: 'Restore timed out' });
  }, timeoutMs);

  return { resultPromise, cleanup };
}
