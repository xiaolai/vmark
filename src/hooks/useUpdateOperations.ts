/**
 * Update Operations Hook
 *
 * Purpose: React adapters over the update flows, plus the cross-window
 *   restart/state events. The flows themselves live in
 *   `services/updates/updateFlows.ts` — they have no React dependency, and
 *   this file outgrew the 300-line limit holding both (ADR-013).
 *
 * Pipeline: User clicks "Check now" in Settings → `checkForUpdates()` →
 *   `runUpdateCheck()` → updates local `useMcpStore` → a subsequent
 *   `downloadAndInstall()` uses the same window's pendingUpdate.
 *
 * Key decisions:
 *   - Run check/download in the calling window (pendingUpdate is window-local).
 *     The previous "always route to main" design broke when main was destroyed
 *     (closed via traffic light / Cmd+W on macOS) — the cross-window emit went
 *     to nobody and the "Check now" button silently did nothing.
 *   - Restart still emits cross-window because it needs to coordinate with
 *     dirty-document handling in the main window's useUpdateChecker.
 *   - Settings → Check, Settings → Download is the typical user path; it
 *     all runs in the Settings window with one consistent pendingUpdate ref.
 *   - clearPendingUpdate exported for cleanup after restart.
 *   - `recoverFromStall` is the release valve for a flow that stops
 *     progressing — see its own doc, and `updateSingleFlight.ts` for why a
 *     `.finally()`-only guard needs one at all (#1270).
 *
 * @coordinates-with updateFlows.ts — the check/download implementations
 * @coordinates-with useUpdateStall.ts — decides when recovery is offered
 * @coordinates-with useUpdateChecker.ts — auto-check on startup (main window)
 * @coordinates-with useUpdateSync.ts — broadcasts state across windows
 * @coordinates-with mcpStore.ts — `update` slice holds status, info, progress
 * @module hooks/useUpdateOperations
 */

import { useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import { useMcpStore } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { runUpdateCheck, runUpdateDownload } from "@/services/updates/updateFlows";
import { clearInFlight } from "@/services/updates/updateSingleFlight";
import { updateFlowLog } from "@/services/updates/updateFlowLog";
import i18n from "@/i18n";

// Event names for cross-window communication
const EVENTS = {
  REQUEST_CHECK: "update:request-check",
  REQUEST_DOWNLOAD: "update:request-download",
  REQUEST_RESTART: "app:restart-for-update",
  REQUEST_STATE: "update:request-state",
} as const;

/**
 * Hook for update operations.
 * Operations run in the calling window — pendingUpdate is window-local.
 */
export function useUpdateOperations() {
  const reset = useMcpStore((state) => state.resetUpdate);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);

  /**
   * Check for updates. Runs inline in the current window so the button
   * stays responsive even when the main window has been closed (the prior
   * emit-only design silently dropped the click in that case).
   */
  const checkForUpdates = useCallback(async () => {
    await runUpdateCheck();
  }, []);

  /**
   * Download and install the pending update. If this window already holds a
   * `pendingUpdate` (just ran Check), download directly; otherwise re-check
   * locally first to populate one (the Settings window doesn't share the
   * main window's window-local `pendingUpdate` object).
   */
  const downloadAndInstall = useCallback(async () => {
    if (!useMcpStore.getState().update.pendingUpdate) {
      await runUpdateCheck();
    }
    if (!useMcpStore.getState().update.pendingUpdate) {
      // Check ran but found no update (already up-to-date or errored).
      // The check itself surfaced the appropriate status — nothing to do.
      return;
    }
    await runUpdateDownload();
  }, []);

  /**
   * Request application restart to apply the update.
   * Emits an event that the main window handles (to check for dirty files first).
   */
  const restartApp = useCallback(async () => {
    await emit(EVENTS.REQUEST_RESTART);
  }, []);

  /**
   * Skip the current version (don't show notification for this version again)
   */
  const skipVersion = useCallback((version: string) => {
    updateUpdateSetting("skipVersion", version);
    reset();
  }, [updateUpdateSetting, reset]);

  /**
   * Request current state from main window.
   * Used when Settings opens to get initial state.
   */
  const requestState = useCallback(async () => {
    await emit(EVENTS.REQUEST_STATE);
  }, []);

  return {
    checkForUpdates,
    downloadAndInstall,
    restartApp,
    skipVersion,
    requestState,
  };
}

/**
 * Hook that handles update operation requests from cross-window emits.
 * Mounted in the main window via useUpdateChecker. Both operations
 * delegate to the shared `runUpdateCheck` / `runUpdateDownload` functions
 * so the auto-check (startup), the manual button (any window), and the
 * download fallback all share one code path.
 */
export function useUpdateOperationHandler() {
  const setError = useMcpStore((state) => state.setUpdateError);

  const doCheckForUpdates = useCallback(async () => runUpdateCheck(), []);

  const doDownloadAndInstall = useCallback(async () => {
    const ok = await runUpdateDownload();
    if (!ok && !useMcpStore.getState().update.error) {
      // No pendingUpdate held here either — surface a clear message.
      setError(i18n.t("dialog:toast.updateNoneToDownload"));
    }
  }, [setError]);

  return {
    doCheckForUpdates,
    doDownloadAndInstall,
    EVENTS,
  };
}

/**
 * Clear the pending update (e.g., when skipping)
 */
export function clearPendingUpdate() {
  useMcpStore.getState().setPendingUpdate(null);
}

/**
 * Release a stalled update flow so the user can try again.
 *
 * `checking`, `downloading` and `installing` are all non-interactive states in
 * the StatusBar indicator, so a flow that stops progressing leaves no way out:
 * the guard is never cleared, every retry joins a promise that will never
 * settle, and the spinner is permanent for the life of the window. This is the
 * release valve for that — the same remedy #1253 needed for window close.
 *
 * Resets the store as well as the guards, which drops `pendingUpdate`. That is
 * deliberate: a retry then runs a fresh `check()` and downloads through a NEW
 * Update resource, rather than re-entering `downloadAndInstall` on the same
 * one, which the plugin does not support.
 *
 * Whatever stalled underneath is NOT cancelled — the updater exposes no
 * cancellation. If it ever completes it writes into a store slice that has
 * moved on, which is harmless; the alternative is a permanently stuck UI.
 */
export function recoverFromStall(): void {
  updateFlowLog("stall:recover", { status: useMcpStore.getState().update.status });
  clearInFlight();
  useMcpStore.getState().resetUpdate();
}
