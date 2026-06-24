/**
 * Hot Exit Restore Hook
 *
 * Restores window state after hot restart. Uses a pull-based approach
 * for reliability — windows pull their state from Rust coordinator
 * rather than waiting for events (which can be missed due to timing).
 *
 * For main window: restoreMainWindowState() is called directly by
 *   checkAndRestoreSession() after Rust invoke returns (bypasses event race).
 * For secondary windows: Pulls pending state via invoke on mount.
 *
 * The RESTORE_START listener in the hook is kept as a fallback but
 * is guarded against double-restore.
 *
 * The restore state machine (concurrency guard + per-window coordination)
 * lives in `createWindowRestoreCoordinator` so it can be unit-tested without
 * React render timing. `useHotExitRestore` is pure lifecycle wiring around it.
 *
 * @coordinates-with restoreHelpers.ts — all restore logic lives there
 */

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { hotExitLog, hotExitWarn } from '@/utils/debug';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { HOT_EXIT_EVENTS } from '../hotExit/types';
import {
  MAX_STATE_RETRIES,
  pullWindowStateWithRetry,
  restoreWindowState,
} from '../hotExit/restoreHelpers';
import {
  reconcileRestoredWindowWorkspaceInstances,
  restoreWindowWorkspaceInstances,
} from '../hotExit/workspaceInstances';
import { errorMessage } from "@/utils/errorMessage";

/** Module-level flag to prevent double-restore of main window */
let mainWindowRestoreStarted = false;

/** Reset the main window restore guard (allows future restores) */
function resetMainRestoreGuard() {
  mainWindowRestoreStarted = false;
}

/**
 * Core restore logic: pull state, restore, signal completion.
 * Shared by restoreMainWindowState() and the hook's coordinator.
 *
 * @returns true if restore succeeded (allDone or partial), false if no state found
 * @throws on restore or invoke failure (caller handles guard reset)
 */
async function pullAndRestore(windowLabel: string): Promise<boolean> {
  const windowState = await pullWindowStateWithRetry(windowLabel);

  if (!windowState) {
    hotExitWarn(`No state found for window '${windowLabel}' after ${MAX_STATE_RETRIES} retries`);
    return false;
  }

  hotExitLog(`Window '${windowLabel}' found pending state, restoring...`);
  restoreWindowWorkspaceInstances(windowLabel, windowState);
  const tabIdMap = await restoreWindowState(windowLabel, windowState);
  reconcileRestoredWindowWorkspaceInstances(windowLabel, windowState, tabIdMap);

  // Signal completion for this window and check if all windows done
  const allDone = await invoke<boolean>('hot_exit_window_restore_complete', { windowLabel });
  hotExitLog(`Window '${windowLabel}' restored successfully (allDone: ${allDone})`);

  if (allDone) {
    await emit(HOT_EXIT_EVENTS.RESTORE_COMPLETE, {});
    resetMainRestoreGuard();
  }

  return true;
}

/** Emit RESTORE_FAILED event (fire-and-forget) */
function emitRestoreFailed(error: string) {
  void emit(HOT_EXIT_EVENTS.RESTORE_FAILED, { error })
    .catch((e) => hotExitWarn('Failed to emit restore failed:', e));
}

/**
 * Pull main window state from Rust and restore it.
 * This is called directly by checkAndRestoreSession after Rust invoke returns
 * (bypasses RESTORE_START event to avoid listener race conditions).
 *
 * Uses a module-level flag to prevent double-restore if the RESTORE_START
 * event listener also fires.
 */
export async function restoreMainWindowState(): Promise<void> {
  const windowLabel = getCurrentWebviewWindow().label;
  if (windowLabel !== 'main') {
    hotExitWarn('restoreMainWindowState called from non-main window');
    return;
  }

  // Guard against double-restore
  if (mainWindowRestoreStarted) {
    hotExitLog('Main window restore already in progress or completed, skipping');
    return;
  }
  mainWindowRestoreStarted = true;

  try {
    const restored = await pullAndRestore(windowLabel);
    if (!restored) {
      resetMainRestoreGuard();
      emitRestoreFailed(`No restore state found for window '${windowLabel}'`);
    }
  } catch (error) {
    resetMainRestoreGuard();
    hotExitWarn('Main window restore failed:', error);
    emitRestoreFailed(errorMessage(error));
  }
}

/**
 * Per-window restore coordinator (state machine).
 *
 * Owns the concurrency guard and the per-window restore flow, independent of
 * React. Exported for direct unit testing of the race / IPC-failure branches
 * that a render-based test cannot reach (React renders are synchronous, so the
 * in-render concurrent path is unreachable via renderHook alone).
 */
export interface WindowRestoreCoordinator {
  /** True once a restore for this window is in flight. */
  isRestoring(): boolean;
  /**
   * Pull and restore this window's state.
   * @param isRequestedRestore - True if triggered by RESTORE_START event
   */
  restore(isRequestedRestore: boolean): Promise<void>;
  /**
   * Run the on-mount check: secondary windows pull immediately; main window
   * waits for the RESTORE_START signal. Idempotent (guards re-entry).
   */
  checkPending(): Promise<void>;
  /** Handle a RESTORE_START event for the main window. */
  onRestoreStart(): Promise<void>;
}

export function createWindowRestoreCoordinator(
  windowLabel: string,
): WindowRestoreCoordinator {
  const isMainWindow = windowLabel === 'main';
  let restoring = false;
  let checkedPending = false;

  const restore = async (isRequestedRestore: boolean): Promise<void> => {
    if (restoring) {
      hotExitWarn(`Window '${windowLabel}' ignoring concurrent restore`);
      return;
    }
    restoring = true;

    try {
      const restored = await pullAndRestore(windowLabel);

      if (!restored && isRequestedRestore && isMainWindow) {
        // Restore was explicitly requested but no state found — emit failure
        // so checkAndRestoreSession doesn't wait until timeout.
        resetMainRestoreGuard();
        hotExitWarn('Restore was requested but no state available');
        emitRestoreFailed(`No restore state found for window '${windowLabel}'`);
      }
    } catch (error) {
      if (isMainWindow) {
        resetMainRestoreGuard();
      }
      hotExitWarn(`Window '${windowLabel}' restore failed:`, error);
      emitRestoreFailed(errorMessage(error));
    } finally {
      restoring = false;
    }
  };

  const checkPending = async (): Promise<void> => {
    if (checkedPending) return;
    checkedPending = true;

    // Secondary windows pull state immediately (Rust creates them after the
    // session is stored). Main window waits for RESTORE_START so it doesn't
    // restore on normal startup.
    if (!isMainWindow) {
      await restore(true);
    }
  };

  const onRestoreStart = async (): Promise<void> => {
    // Only the main window acts on RESTORE_START; secondary windows restore
    // on mount.
    if (!isMainWindow) return;
    if (mainWindowRestoreStarted) {
      hotExitLog('RESTORE_START received but restore already started, ignoring');
      return;
    }
    // Set flag to prevent double-restore via the direct call path.
    mainWindowRestoreStarted = true;
    await restore(true);
  };

  return {
    isRestoring: () => restoring,
    restore,
    checkPending,
    onRestoreStart,
  };
}

export function useHotExitRestore() {
  // The coordinator is created once per mount and holds the restore state
  // machine; the hook only wires it to mount/unmount lifecycle.
  const coordinatorRef = useRef<WindowRestoreCoordinator | null>(null);

  useEffect(() => {
    const windowLabel = getCurrentWebviewWindow().label;
    const coordinator =
      coordinatorRef.current ?? createWindowRestoreCoordinator(windowLabel);
    coordinatorRef.current = coordinator;

    void coordinator.checkPending();

    // Listen for RESTORE_START signal (fallback for main window). Primary
    // restore is triggered directly by checkAndRestoreSession(); this listener
    // is guarded against double-restore.
    const unlistenPromise = listen(HOT_EXIT_EVENTS.RESTORE_START, () =>
      coordinator.onRestoreStart(),
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch((e) => {
        hotExitLog('Cleanup error (expected during unmount):', e);
      });
    };
  }, []);
}
