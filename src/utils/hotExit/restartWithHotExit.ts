/**
 * Hot Exit Restart Helper
 *
 * Captures session before restart and restores after relaunch.
 *
 * CRITICAL: Session file lifecycle:
 * - Captured before restart
 * - Deleted ONLY after restore-complete event (not before!)
 * - Kept on failure for retry on next launch
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { SessionData } from './types';
import { HOT_EXIT_EVENTS } from './types';
import { migrateSession, canMigrate, needsMigration, SCHEMA_VERSION } from './schemaMigration';
import { restoreMainWindowState } from './useHotExitRestore';
import { hotExitLog, hotExitWarn } from '@/utils/debug';

/** Default timeout for restore operation in milliseconds */
const DEFAULT_RESTORE_TIMEOUT_MS = 15000;

/** Tauri command names - centralized to avoid typos */
const HOT_EXIT_COMMANDS = {
  CAPTURE: 'hot_exit_capture',
  INSPECT: 'hot_exit_inspect_session',
  CLEAR: 'hot_exit_clear_session',
  RESTORE: 'hot_exit_restore',
  RESTORE_MULTI: 'hot_exit_restore_multi_window',
} as const;

/**
 * Safely format a timestamp for logging
 */
function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return `invalid(${timestamp})`;
  }
  try {
    return new Date(timestamp * 1000).toISOString();
  } catch {
    return `invalid(${timestamp})`;
  }
}

/**
 * Clear session file with error handling
 */
async function clearSessionFile(context: string): Promise<void> {
  try {
    await invoke<void>(HOT_EXIT_COMMANDS.CLEAR);
    hotExitLog(`Cleared session file (${context})`);
  } catch (clearError) {
    hotExitWarn(`Failed to clear session file (${context}):`, clearError);
  }
}

/**
 * Capture session, write to disk, then restart app.
 * Session will be automatically restored on next startup via useHotExitRestore.
 */
export async function restartWithHotExit(): Promise<void> {
  try {
    // Capture session from all windows and write atomically to disk
    // This command waits for all windows to respond with 5s timeout
    const session = await invoke<SessionData>(HOT_EXIT_COMMANDS.CAPTURE);

    hotExitLog('Session captured and persisted:', {
      windows: session.windows.length,
      version: session.vmark_version,
    });
  } catch (error) {
    const captureError = error instanceof Error ? error : new Error(String(error));
    console.error('[HotExit] Failed to capture session before restart:', captureError); // intentional: critical error before relaunch
    // Continue to relaunch - user already confirmed restart
  }

  // Relaunch regardless of capture success (user confirmed restart)
  try {
    await relaunch();
  } catch (error) {
    console.error('[HotExit] Failed to relaunch:', error); // intentional: critical relaunch failure
    throw error;
  }
}

/**
 * Check for saved session on startup and restore if present.
 * Called from App.tsx during initialization.
 * MUST only be called from the main window to avoid concurrent restore attempts.
 *
 * CRITICAL: Session file is ONLY deleted after restore-complete event is received.
 * If restore fails or times out, session is preserved for retry on next launch.
 *
 * @param timeoutMs - Maximum time to wait for restore completion (default: 15000ms)
 * @returns true if restore completed successfully, false otherwise
 */
export async function checkAndRestoreSession(
  timeoutMs: number = DEFAULT_RESTORE_TIMEOUT_MS
): Promise<boolean> {
  // Runtime guard: only main window should trigger restore
  const windowLabel = getCurrentWebviewWindow().label;
  if (windowLabel !== 'main') {
    hotExitWarn(`checkAndRestoreSession called from non-main window: ${windowLabel}`);
    return false;
  }

  // Sanitize timeout to valid positive number
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_RESTORE_TIMEOUT_MS;

  try {
    const session = await invoke<SessionData | null>(HOT_EXIT_COMMANDS.INSPECT);

    if (!session) {
      hotExitLog('No saved session found');
      return false;
    }

    // Check if session can be migrated
    if (!canMigrate(session.version)) {
      hotExitLog(`Cannot restore session: incompatible version ${session.version} (current: ${SCHEMA_VERSION})`);
      await clearSessionFile('incompatible version');
      return false;
    }

    // Migrate session if needed (frontend applies migration before sending to Rust)
    let migratedSession = session;
    if (needsMigration(session)) {
      hotExitLog(`Migrating session from v${session.version} to v${SCHEMA_VERSION}`);
      migratedSession = migrateSession(session);
    }

    const hasSecondaryWindows = migratedSession.windows.some(w => !w.is_main_window);

    hotExitLog('Found saved session:', {
      windows: migratedSession.windows.length,
      hasSecondaryWindows,
      timestamp: formatTimestamp(migratedSession.timestamp),
      version: migratedSession.vmark_version,
      schemaVersion: migratedSession.version,
    });

    // CRITICAL: Set up event listeners and WAIT for them to be ready
    // before invoking restore commands. This prevents race conditions.
    const { resultPromise, cleanup } = await setupRestoreListeners(safeTimeout);

    try {
      // Use multi-window restore if session has secondary windows
      // Otherwise use legacy single-window restore
      if (hasSecondaryWindows) {
        const result = await invoke<{ windows_created: string[] }>(
          HOT_EXIT_COMMANDS.RESTORE_MULTI,
          { session: migratedSession }
        );
        hotExitLog('Multi-window restore initiated:', {
          windowsCreated: result.windows_created,
        });
      } else {
        // Legacy single-window restore
        await invoke<void>(HOT_EXIT_COMMANDS.RESTORE, { session: migratedSession });
      }

      // CRITICAL: Directly trigger main window restore after Rust invoke returns.
      // This bypasses the RESTORE_START event listener race condition where
      // useHotExitRestore's listener may not be registered when Rust emits the event.
      // By the time invoke returns, Rust has already stored state in PendingRestoreState.
      hotExitLog('Invoking main window restore directly (bypassing event)');
      await restoreMainWindowState();
    } catch (invokeError) {
      // Invoke failed - clean up listeners and rethrow
      cleanup();
      throw invokeError;
    }

    // CRITICAL: Wait for restore to complete BEFORE deleting session
    // This prevents data loss if restore fails partway through
    const restoreResult = await resultPromise;

    if (restoreResult.success) {
      await clearSessionFile('restore success');
      return true;
    } else {
      // Restore failed or timed out - keep session file for retry
      hotExitLog('Restore failed:', restoreResult.error);
      hotExitLog('Session file preserved for retry on next launch');
      return false;
    }
  } catch (error) {
    hotExitLog('Failed to restore session:', error);
    return false;
  }
}

/** Result type for restore listener setup */
interface RestoreListenerHandle {
  /** Promise that resolves when restore completes or fails */
  resultPromise: Promise<{ success: boolean; error?: string }>;
  /** Cleanup function to call if invoke fails */
  cleanup: () => void;
}

/**
 * Set up restore event listeners and wait for them to be ready.
 *
 * This function AWAITS listener registration before returning, ensuring
 * no race condition between listener setup and event emission.
 *
 * @param timeoutMs - Maximum time to wait for restore completion
 * @returns Handle with result promise and cleanup function
 */
async function setupRestoreListeners(timeoutMs: number): Promise<RestoreListenerHandle> {
  let resolved = false;
  let resolveResult: (result: { success: boolean; error?: string }) => void;
  let unlistenComplete: (() => void) | undefined;
  let unlistenFailed: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const resultPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
    resolveResult = resolve;
  });

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (unlistenComplete) {
      unlistenComplete();
      unlistenComplete = undefined;
    }
    if (unlistenFailed) {
      unlistenFailed();
      unlistenFailed = undefined;
    }
  };

  const handleResolve = (result: { success: boolean; error?: string }) => {
    if (resolved) return;
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
