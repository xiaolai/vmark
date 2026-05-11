/**
 * Update Operations Hook
 *
 * Purpose: Provides check/download/install/restart operations for app updates.
 *   The actual check/download work runs in whichever window the user clicked
 *   from — `pendingUpdate` is a Tauri JS resource that can't cross window
 *   boundaries, so the operation must complete in the same window that
 *   created it. Cross-window emit is reserved for restart (no shared state).
 *
 * Pipeline: User clicks "Check now" in Settings → `checkForUpdates()` calls
 *   Tauri updater `check()` directly → updates local `useUpdateStore` →
 *   subsequent `downloadAndInstall()` uses the same window's pendingUpdate.
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
 *   - Version comparison uses getVersion() from Tauri app API.
 *
 * @coordinates-with useUpdateChecker.ts — auto-check on startup (main window)
 * @coordinates-with useUpdateSync.ts — broadcasts state across windows
 * @coordinates-with updateStore.ts — stores status, info, progress
 * @module hooks/useUpdateOperations
 */

import { useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { emit } from "@tauri-apps/api/event";
import { useUpdateStore } from "@/stores/updateStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getVersion } from "@tauri-apps/api/app";
import i18n from "@/i18n";

// Event names for cross-window communication
const EVENTS = {
  REQUEST_CHECK: "update:request-check",
  REQUEST_DOWNLOAD: "update:request-download",
  REQUEST_RESTART: "app:restart-for-update",
  REQUEST_STATE: "update:request-state",
} as const;

/**
 * Run the update check inline in the current window. Updates the local
 * `useUpdateStore` and stores `pendingUpdate` here so the same window can
 * later call download. Standalone (no React deps) so any caller — manual
 * button, auto-check on startup, the legacy cross-window listener — can
 * share the same code path.
 */
export async function runUpdateCheck(): Promise<boolean> {
  const store = useUpdateStore.getState();
  const settings = useSettingsStore.getState();

  store.setStatus("checking");

  try {
    const update = await check();

    if (update) {
      store.setPendingUpdate(update);
      const currentVersion = await getVersion();
      store.setUpdateInfo({
        version: update.version,
        notes: update.body ?? "",
        pubDate: update.date ?? "",
        currentVersion,
      });
      store.setStatus("available");
      // New update — clear any prior dismiss flag so the banner shows.
      store.clearDismissed();
      settings.updateUpdateSetting("lastCheckTimestamp", Date.now());
      return true;
    }

    store.setStatus("up-to-date");
    store.setPendingUpdate(null);
    settings.updateUpdateSetting("lastCheckTimestamp", Date.now());
    return false;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : i18n.t("dialog:toast.updateCheckFailedGeneric");
    store.setError(message);
    // Don't update lastCheckTimestamp on error — the check didn't complete.
    return false;
  }
}

/**
 * Run download/install inline in the current window using the local
 * `pendingUpdate`. Returns false if no pendingUpdate is held here (caller
 * may decide to re-check or surface an error).
 */
export async function runUpdateDownload(): Promise<boolean> {
  const initial = useUpdateStore.getState();
  const pendingUpdate = initial.pendingUpdate;
  if (!pendingUpdate) return false;

  const store = useUpdateStore.getState();
  store.setStatus("downloading");
  store.setDownloadProgress({ downloaded: 0, total: null });

  // Track progress in local variables to avoid stale state on rapid updates.
  let downloadedBytes = 0;
  let totalBytes: number | null = null;

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      const live = useUpdateStore.getState();
      switch (event.event) {
        case "Started":
          downloadedBytes = 0;
          totalBytes = event.data.contentLength ?? null;
          live.setDownloadProgress({ downloaded: 0, total: totalBytes });
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength;
          live.setDownloadProgress({ downloaded: downloadedBytes, total: totalBytes });
          break;
        case "Finished":
          live.setDownloadProgress(null);
          break;
      }
    });

    useUpdateStore.getState().setStatus("ready");
    return true;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : i18n.t("dialog:toast.updateDownloadFailedGeneric");
    useUpdateStore.getState().setError(message);
    return false;
  }
}

/**
 * Hook for update operations.
 * Operations run in the calling window — pendingUpdate is window-local.
 */
export function useUpdateOperations() {
  const reset = useUpdateStore((state) => state.reset);
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
   * Download and install the pending update. Prefers the local
   * `pendingUpdate` (typical: user just clicked Check in this same window).
   * Falls back to a cross-window emit so the main window's auto-checked
   * pendingUpdate can still drive the download when the user hits Download
   * from a window that didn't run the check itself.
   */
  const downloadAndInstall = useCallback(async () => {
    if (useUpdateStore.getState().pendingUpdate) {
      await runUpdateDownload();
      return;
    }
    await emit(EVENTS.REQUEST_DOWNLOAD);
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
  const setError = useUpdateStore((state) => state.setError);

  const doCheckForUpdates = useCallback(async () => runUpdateCheck(), []);

  const doDownloadAndInstall = useCallback(async () => {
    const ok = await runUpdateDownload();
    if (!ok && !useUpdateStore.getState().error) {
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
  useUpdateStore.getState().setPendingUpdate(null);
}
