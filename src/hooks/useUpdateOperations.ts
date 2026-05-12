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

// Per-window single-flight gates. When the user spam-clicks "Check Now" or
// when the auto-retry timer overlaps a manual click, every caller awaits the
// same in-flight promise instead of issuing a parallel `check()` against the
// Tauri updater plugin. The previous design let parallel checks pile up,
// each broadcasting their own error and triggering the cross-window listener
// — a contributing factor to the v0.7.11 freeze report.
// Held inside a holder object so the formatter doesn't rewrite the
// reassignment to `const` (assignments happen inside the run* helpers).
const inFlight: { check: Promise<boolean> | null; download: Promise<boolean> | null } = {
  check: null,
  download: null,
};

/**
 * Run the update check inline in the current window. Updates the local
 * `useUpdateStore` and stores `pendingUpdate` here so the same window can
 * later call download. Standalone (no React deps) so any caller — manual
 * button, auto-check on startup, the legacy cross-window listener — can
 * share the same code path.
 */
export async function runUpdateCheck(): Promise<boolean> {
  // Single-flight: if a check is already in progress in this window, every
  // caller (manual button, auto-check, retry timer, cross-window listener)
  // shares the same result. Otherwise overlapping callers spawn parallel
  // `check()` requests, each broadcasting status churn back to the other
  // window via useUpdateSync — the cascade behind the v0.7.11 freeze.
  if (inFlight.check) return inFlight.check;

  inFlight.check = (async () => {
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
    } finally {
      inFlight.check = null;
    }
  })();

  return inFlight.check;
}

/**
 * Run download/install inline in the current window using the local
 * `pendingUpdate`. Returns false if no pendingUpdate is held here (caller
 * may decide to re-check or surface an error).
 */
export async function runUpdateDownload(): Promise<boolean> {
  // Single-flight: prevent two callers (manual click + auto-download effect)
  // from each invoking pendingUpdate.downloadAndInstall on the same Update
  // resource — the underlying Tauri resource is not safe to download twice.
  if (inFlight.download) return inFlight.download;

  const initial = useUpdateStore.getState();
  const pendingUpdate = initial.pendingUpdate;
  if (!pendingUpdate) return false;

  inFlight.download = (async () => {
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
    } finally {
      inFlight.download = null;
    }
  })();

  return inFlight.download;
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
   * Download and install the pending update.
   *
   * If this window already holds a `pendingUpdate` (typical: it just ran
   * Check), download directly. Otherwise re-run check locally first to
   * populate one — this is the case where the main window auto-checked
   * (so its store has pendingUpdate) but the user clicked Download from
   * a different window (Settings) whose store doesn't have the object.
   *
   * The earlier emit-fallback pattern silently no-op'd when the main
   * window was destroyed — same class of bug the inline-check fix
   * targeted for the Check Now button. Re-checking locally is bounded
   * (one extra HTTP HEAD if needed) and self-contained.
   */
  const downloadAndInstall = useCallback(async () => {
    if (!useUpdateStore.getState().pendingUpdate) {
      await runUpdateCheck();
    }
    if (!useUpdateStore.getState().pendingUpdate) {
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
