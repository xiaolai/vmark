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
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { SessionData } from './types';
import { migrateSession, canMigrate, needsMigration, SCHEMA_VERSION } from './schemaMigration';
import { hasSecondaryWindows, salvageSessionPayload } from './restoreDispatch';
import { quarantineSessionEntries } from './sessionQuarantine';
import { setupRestoreListeners } from './restoreListeners';
import { restoreMainWindowState } from '../resilience/_hotExitRestore';
import { hotExitLog, hotExitWarn, hotExitError } from '@/utils/debug';
import { commandErrorMessage } from '@/services/commands/commandError';

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
    /* v8 ignore start -- @preserve Date constructor only throws for NaN; valid timestamps never reach this */
    return `invalid(${timestamp})`;
    /* v8 ignore stop */
  }
}

/**
 * Did Rust serve the BACKUP because the main session file was unusable?
 *
 * `hot_exit_inspect_session` reports `recovered_from_backup: bool` alongside
 * the session's own fields (src-tauri/src/hot_exit/commands.rs
 * `InspectedSession`). Without it the frontend could not see the case that
 * matters most: `storage.rs::read_session` substitutes `session.prev.json`
 * UPSTREAM of the salvage boundary, so the payload arriving here is perfectly
 * valid, nothing is quarantined, and a successful restore clears BOTH files —
 * destroying the corrupt main bytes unread.
 *
 * Absence still reads as `false`: Rust omits the field when it is false (the
 * crate's "absent optionals are ABSENT" wire convention), so a clean read has
 * no key at all.
 */
function wasRecoveredFromBackup(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { recovered_from_backup?: unknown }).recovered_from_backup === true
  );
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
 *
 * A FAILED CAPTURE ABORTS THE RESTART (audit 20260906, F2). What the user
 * agreed to is "restart and restore my unsaved documents"; if the snapshot
 * could not be written, the second half is not on offer and the restart is a
 * different, worse deal than the one they accepted. This used to log the
 * rejection and relaunch anyway, so unsaved text that had never reached a
 * recoverable snapshot went with the process.
 *
 * Nothing downstream can rescue it either: `relaunch()` goes through
 * `AppHandle::request_restart()`, and Tauri's `ExitRequestApi::prevent_exit()`
 * explicitly ignores `RESTART_EXIT_CODE` — so the coordinated normal-quit
 * handler in `app_setup.rs`, which does save dirty buffers on an ordinary
 * quit, never gets the chance here.
 *
 * @throws the capture failure, so the caller can tell the user and reset its
 * UI. `useUpdateChecker` already emits `update:restart-cancelled` from its
 * catch, and the process stays alive with every document still open.
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
    // The hot_exit commands return `Result<_, CommandError>`, which is a plain
    // OBJECT — `String(error)` on one logs the literal "[object Object]".
    const captureError = error instanceof Error ? error : new Error(commandErrorMessage(error));
    hotExitError('Failed to capture session before restart:', captureError);
    throw captureError;
  }

  try {
    await relaunch();
  } catch (error) {
    hotExitError('Failed to relaunch:', error);
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
    // WI-3: the persisted payload is untrusted at this boundary — salvage it
    // through the Zod schemas before migration/dispatch. Failures are
    // quarantined (preserved on disk), and an unusable payload leaves the
    // session file in place instead of clearing it.
    const rawSession = await invoke<unknown>(HOT_EXIT_COMMANDS.INSPECT);
    const salvage = salvageSessionPayload(rawSession);
    const recoveredFromBackup = wasRecoveredFromBackup(rawSession);

    if (salvage.status === 'empty') {
      hotExitLog('No saved session found');
      return false;
    }
    if (salvage.quarantined.length > 0) {
      const preserved = await quarantineSessionEntries(salvage.quarantined);
      if (!preserved) {
        // Preservation beats restore: without the artifact, a successful
        // restore would clear the session file and destroy the corrupt bytes.
        hotExitWarn('Quarantine write failed; keeping session file, skipping restore');
        return false;
      }
    }
    if (salvage.status === 'invalid') {
      hotExitWarn('Session payload failed validation; file kept, quarantine artifact written');
      return false;
    }
    const session = salvage.session;

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

    const hasSecondary = hasSecondaryWindows(migratedSession);

    hotExitLog('Found saved session:', {
      windows: migratedSession.windows.length,
      hasSecondaryWindows: hasSecondary,
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
      if (hasSecondary) {
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
      // Audit 20260804-F10: DELETING is the irreversible half of this
      // function, so it is refused whenever the payload was not wholly
      // readable. Two triggers:
      //   - salvage rejected material: something in that file failed schema
      //     validation, and the quarantine artifact is a DERIVED copy. Keeping
      //     the original costs one stale file (the next quit overwrites it);
      //     deleting it costs the only pristine evidence of the corruption.
      //   - Rust served the backup: the corrupt main file was never seen by
      //     the salvage boundary at all, so clearing would erase it unread.
      //     See the TODO(WI-3-followup) above — this arm is unreachable until
      //     the Rust half reports the substitution.
      if (salvage.quarantined.length > 0 || recoveredFromBackup) {
        hotExitLog(
          'Restore succeeded, but the payload was not wholly readable — session file preserved',
          { quarantined: salvage.quarantined.length, recoveredFromBackup }
        );
        return true;
      }
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
