/**
 * Update Operations Hook
 *
 * Provides operations for downloading, installing, and restarting
 * after an update is available.
 */

import { useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { emit } from "@tauri-apps/api/event";
import { useUpdateStore } from "@/stores/updateStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getVersion } from "@tauri-apps/api/app";

// Store the update object for download/install
let pendingUpdate: Update | null = null;

export function useUpdateOperations() {
  const setStatus = useUpdateStore((state) => state.setStatus);
  const setUpdateInfo = useUpdateStore((state) => state.setUpdateInfo);
  const setDownloadProgress = useUpdateStore((state) => state.setDownloadProgress);
  const setError = useUpdateStore((state) => state.setError);
  const reset = useUpdateStore((state) => state.reset);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);

  /**
   * Check for updates and store result
   */
  const checkForUpdates = useCallback(async () => {
    setStatus("checking");
    setError(null);

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
        return true;
      } else {
        setStatus("up-to-date");
        pendingUpdate = null;
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check for updates";
      setError(message);
      setStatus("error");
      return false;
    } finally {
      // Update last check timestamp
      updateUpdateSetting("lastCheckTimestamp", Date.now());
    }
  }, [setStatus, setError, setUpdateInfo, updateUpdateSetting]);

  /**
   * Download and install the pending update
   */
  const downloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) {
      setError("No update available to download");
      return;
    }

    setStatus("downloading");
    setDownloadProgress({ downloaded: 0, total: null });

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setDownloadProgress({
              downloaded: 0,
              total: event.data.contentLength ?? null,
            });
            break;
          case "Progress":
            setDownloadProgress((prev) => ({
              downloaded: (prev?.downloaded ?? 0) + event.data.chunkLength,
              total: prev?.total ?? null,
            }));
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
      setStatus("error");
    }
  }, [setStatus, setDownloadProgress, setError]);

  /**
   * Request application restart to apply the update.
   * Emits an event that the main window handles (to check for dirty files first).
   */
  const restartApp = useCallback(async () => {
    try {
      // Emit event for main window to handle (it will check for dirty files)
      await emit("app:restart-for-update");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to request restart";
      setError(message);
    }
  }, [setError]);

  /**
   * Skip the current version (don't show notification for this version again)
   */
  const skipVersion = useCallback((version: string) => {
    updateUpdateSetting("skipVersion", version);
    reset();
    pendingUpdate = null;
  }, [updateUpdateSetting, reset]);

  return {
    checkForUpdates,
    downloadAndInstall,
    restartApp,
    skipVersion,
  };
}
