/**
 * Update check and download flows.
 *
 * Purpose: the two standalone operations behind every update entry point —
 *   the manual button, the startup auto-check, the retry timer and the
 *   cross-window listener all share these, so the Tauri updater plugin sees
 *   one call path per window.
 *
 * These live in `services/` rather than `hooks/` because they have no React
 * dependency at all (ADR-013). They were extracted from `useUpdateOperations`
 * when that file outgrew the 300-line limit; the hooks there are now thin
 * React adapters over these.
 *
 * Key decisions:
 *   - Both run in the CALLING window. `pendingUpdate` is a Tauri JS resource
 *     that cannot cross window boundaries, so the download must happen in the
 *     window whose check created it.
 *   - Single-flight per window via the shared `inFlight` guards, so spam
 *     clicks, the auto-retry timer and the auto-download effect await one
 *     promise instead of issuing parallel plugin calls (parallel-check churn
 *     was a contributor to the v0.7.11 freeze).
 *
 * @coordinates-with useUpdateOperations.ts — the React adapters
 * @coordinates-with updateSingleFlight.ts — the guards these set and clear
 * @coordinates-with updateProgressThrottle.ts — coalesces per-chunk writes
 * @module services/updates/updateFlows
 */

import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { useMcpStore } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { shouldWriteProgress } from "@/services/updates/updateProgressThrottle";
import { inFlight } from "@/services/updates/updateSingleFlight";
import { updateFlowLog } from "@/services/updates/updateFlowLog";
import i18n from "@/i18n";

/**
 * Bound the check so a stalled connection cannot hold the single-flight guard
 * open forever. Milliseconds — the plugin passes this to `Duration::from_millis`
 * and then to the HTTP request. This is a small metadata fetch, so 30s is
 * generous.
 *
 * The DOWNLOAD is deliberately left unbounded. The plugin applies `timeout` as
 * a TOTAL request timeout including body read, so any value low enough to catch
 * a stall would also abort a legitimate slow download of a ~40MB artifact —
 * worse than the bug it would fix. The download's stall path is handled by
 * `recoverFromStall` instead.
 */
const UPDATE_CHECK_TIMEOUT_MS = 30_000;

/**
 * Run the update check inline in the current window. Updates the local
 * `useMcpStore` and stores `pendingUpdate` here so the same window can
 * later call download.
 */
export async function runUpdateCheck(): Promise<boolean> {
  // Single-flight: if a check is already in progress in this window, every
  // caller (manual button, auto-check, retry timer, cross-window listener)
  // shares the same result. Otherwise overlapping callers spawn parallel
  // `check()` requests, each broadcasting status churn back to the other
  // window via useUpdateSync — the cascade behind the v0.7.11 freeze.
  if (inFlight.check) return inFlight.check;

  inFlight.check = (async () => {
    const store = useMcpStore.getState();
    const settings = useSettingsStore.getState();

    store.setUpdateStatus("checking");
    updateFlowLog("check:start");

    try {
      const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      updateFlowLog("check:returned", { found: update !== null });

      if (update) {
        store.setPendingUpdate(update);
        const currentVersion = await getVersion();
        store.setUpdateInfo({
          version: update.version,
          notes: update.body ?? "",
          pubDate: update.date ?? "",
          currentVersion,
        });
        store.setUpdateStatus("available");
        // New update — clear any prior dismiss flag so the banner shows.
        store.clearDismissed();
        settings.updateUpdateSetting("lastCheckTimestamp", Date.now());
        return true;
      }

      store.setUpdateStatus("up-to-date");
      store.setPendingUpdate(null);
      settings.updateUpdateSetting("lastCheckTimestamp", Date.now());
      return false;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : i18n.t("dialog:toast.updateCheckFailedGeneric");
      updateFlowLog("check:failed", message);
      store.setUpdateError(message);
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

  const initial = useMcpStore.getState();
  const pendingUpdate = initial.update.pendingUpdate;
  if (!pendingUpdate) return false;

  inFlight.download = (async () => {
    const store = useMcpStore.getState();
    store.setUpdateStatus("downloading");
    store.setDownloadProgress({ downloaded: 0, total: null });
    updateFlowLog("download:start");

    // Track progress in locals (avoids stale-state reads). Store writes are
    // throttled via shouldWriteProgress so a chunky download doesn't flood
    // re-renders and the cross-window broadcast.
    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    let lastWritten = -1;

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        const live = useMcpStore.getState();
        switch (event.event) {
          case "Started":
            downloadedBytes = 0;
            totalBytes = event.data.contentLength ?? null;
            lastWritten = 0;
            live.setDownloadProgress({ downloaded: 0, total: totalBytes });
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            if (shouldWriteProgress(downloadedBytes, lastWritten, totalBytes)) {
              lastWritten = downloadedBytes;
              live.setDownloadProgress({ downloaded: downloadedBytes, total: totalBytes });
            }
            break;
          case "Finished":
            // Bytes are in; the updater now writes/installs them (takes a
            // moment). Snap to 100% and switch to the install phase instead of
            // leaving a frozen "Downloading…" with no bar.
            live.setDownloadProgress({ downloaded: totalBytes ?? downloadedBytes, total: totalBytes });
            live.setUpdateStatus("installing");
            updateFlowLog("download:finished", { bytes: totalBytes ?? downloadedBytes });
            break;
        }
      });

      const done = useMcpStore.getState();
      done.setUpdateStatus("ready");
      done.setDownloadProgress(null);
      updateFlowLog("install:ready");
      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : i18n.t("dialog:toast.updateDownloadFailedGeneric");
      updateFlowLog("download:failed", message);
      const failed = useMcpStore.getState();
      failed.setDownloadProgress(null);
      failed.setUpdateError(message);
      return false;
    } finally {
      inFlight.download = null;
    }
  })();

  return inFlight.download;
}
