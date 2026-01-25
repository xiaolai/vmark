/**
 * Update Operations Hook
 *
 * Provides operations for checking, downloading, installing, and restarting.
 *
 * IMPORTANT: The actual operations run in the main window only.
 * Other windows emit events requesting operations, and main window handles them.
 * This ensures the `pendingUpdate` object is always in the same JS context.
 */

import { useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { emit } from "@tauri-apps/api/event";
import { useUpdateStore } from "@/stores/updateStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getVersion } from "@tauri-apps/api/app";

// Store the update object for download/install - only valid in main window
let pendingUpdate: Update | null = null;

// Event names for cross-window communication
const EVENTS = {
  REQUEST_CHECK: "update:request-check",
  REQUEST_DOWNLOAD: "update:request-download",
  REQUEST_RESTART: "app:restart-for-update",
  REQUEST_STATE: "update:request-state",
} as const;

/**
 * Hook for update operations.
 * Can be called from any window - operations are routed to main window.
 */
export function useUpdateOperations() {
  const reset = useUpdateStore((state) => state.reset);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);

  /**
   * Check for updates.
   * If called from main window, runs directly.
   * If called from other windows, emits event for main window to handle.
   */
  const checkForUpdates = useCallback(async () => {
    // Always emit event - main window will handle it
    // This works from any window
    await emit(EVENTS.REQUEST_CHECK);
  }, []);

  /**
   * Download and install the pending update.
   * Emits event for main window to handle (since pendingUpdate is there).
   */
  const downloadAndInstall = useCallback(async () => {
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
 * Hook that handles update operation requests.
 * Should ONLY be used in the main window.
 * Listens for events from other windows and performs the actual operations.
 */
export function useUpdateOperationHandler() {
  const setStatus = useUpdateStore((state) => state.setStatus);
  const setUpdateInfo = useUpdateStore((state) => state.setUpdateInfo);
  const setDownloadProgress = useUpdateStore((state) => state.setDownloadProgress);
  const setError = useUpdateStore((state) => state.setError);
  const clearDismissed = useUpdateStore((state) => state.clearDismissed);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);

  /**
   * Perform the actual check operation (main window only)
   */
  const doCheckForUpdates = useCallback(async () => {
    setStatus("checking");

    try {
      const update = await check();

      if (update) {
        pendingUpdate = update;
        const currentVersion = await getVersion();
        setUpdateInfo({
          version: update.version,
          notes: update.body ?? "",
          pubDate: update.date ?? "",
          currentVersion,
        });
        setStatus("available");
        // Reset dismissed flag so new update shows notification banner
        clearDismissed();
        updateUpdateSetting("lastCheckTimestamp", Date.now());
        return true;
      } else {
        setStatus("up-to-date");
        pendingUpdate = null;
        updateUpdateSetting("lastCheckTimestamp", Date.now());
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check for updates";
      setError(message);
      // Don't update lastCheckTimestamp on error - the check didn't complete successfully
      return false;
    }
  }, [setStatus, setUpdateInfo, setError, clearDismissed, updateUpdateSetting]);

  /**
   * Perform the actual download operation (main window only)
   */
  const doDownloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) {
      setError("No update available to download");
      return;
    }

    setStatus("downloading");
    setDownloadProgress({ downloaded: 0, total: null });

    // Track progress in local variables to avoid stale state issues with rapid updates
    let downloadedBytes = 0;
    let totalBytes: number | null = null;

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloadedBytes = 0;
            totalBytes = event.data.contentLength ?? null;
            setDownloadProgress({ downloaded: 0, total: totalBytes });
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            setDownloadProgress({ downloaded: downloadedBytes, total: totalBytes });
            break;
          case "Finished":
            setDownloadProgress(null);
            break;
        }
      });

      setStatus("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to download update";
      setError(message);
    }
  }, [setStatus, setDownloadProgress, setError]);

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
  pendingUpdate = null;
}
