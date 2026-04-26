/**
 * Update Checker Hook
 *
 * Purpose: Automatic update checking on app startup — respects user
 *   frequency preference (startup/daily/weekly/manual) and delegates
 *   actual download/install to the main window context.
 *
 * Pipeline: App startup → delay (2s) → check frequency vs lastCheckTime
 *   → invoke Tauri updater plugin → updateStore tracks status → prompt
 *   user to install → restartWithHotExit for seamless update
 *
 * Key decisions:
 *   - All update operations funneled to main window (pendingUpdate object lives there)
 *   - Other windows emit request events; main window listens and executes
 *   - Exponential backoff retry (3 attempts, 5s base delay) for network failures
 *   - Startup check delayed 2s to let app initialize first
 *
 * @coordinates-with useUpdateOperations.ts — provides check/download/restart functions
 * @coordinates-with useUpdateSync.ts — syncs update state across windows
 * @coordinates-with updateStore.ts — tracks status, info, progress, errors
 * @module hooks/useUpdateChecker
 */

import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/utils/imeToast";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore, type UpdateStatus } from "@/stores/updateStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUpdateOperationHandler, clearPendingUpdate } from "./useUpdateOperations";
import { restartWithHotExit } from "@/utils/hotExit/restartWithHotExit";
import { updateCheckerLog } from "@/utils/debug";
import i18n from "@/i18n";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

// Time constants in milliseconds
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;
const STARTUP_CHECK_DELAY_MS = 2000; // Delay to let app initialize before checking

// Retry constants
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5000; // 5 seconds base delay

/**
 * Determine if we should check for updates based on settings and last check time.
 */
function shouldCheckNow(
  autoCheckEnabled: boolean,
  frequency: string,
  lastCheckTimestamp: number | null
): boolean {
  if (!autoCheckEnabled) return false;
  if (frequency === "manual") return false;
  if (frequency === "startup") return true;

  if (!lastCheckTimestamp) return true;

  const elapsed = Date.now() - lastCheckTimestamp;

  if (frequency === "daily") {
    return elapsed >= ONE_DAY;
  }

  if (frequency === "weekly") {
    return elapsed >= ONE_WEEK;
  }

  return false;
}

/**
 * Hook to check for updates on startup and handle cross-window requests.
 * Should be used in the main window only.
 */
export function useUpdateChecker() {
  const hasChecked = useRef(false);
  const hasAutoDownloaded = useRef(false);
  const retryCount = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isManualCheck = useRef(false);
  const { doCheckForUpdates, doDownloadAndInstall, EVENTS } = useUpdateOperationHandler();

  const autoCheckEnabled = useSettingsStore((state) => state.update.autoCheckEnabled);
  const checkFrequency = useSettingsStore((state) => state.update.checkFrequency);
  const lastCheckTimestamp = useSettingsStore((state) => state.update.lastCheckTimestamp);
  const skipVersion = useSettingsStore((state) => state.update.skipVersion);
  const autoDownload = useSettingsStore((state) => state.update.autoDownload);

  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const dismiss = useUpdateStore((state) => state.dismiss);

  // Track previous status for toast notifications
  const prevStatusRef = useRef<UpdateStatus | null>(null);
  // Separate prev-status tracker for the retry effect — both effects depend
  // on `status`, so React runs them in declaration order. If they shared one
  // ref, the toast effect (declared first) would overwrite it before the
  // retry effect reads it, making retry/exhaustion logic dead code.
  const prevStatusForRetryRef = useRef<UpdateStatus | null>(null);

  // Check for updates on startup if needed
  useEffect(() => {
    if (hasChecked.current) return;

    if (shouldCheckNow(autoCheckEnabled, checkFrequency, lastCheckTimestamp)) {
      hasChecked.current = true;

      const timer = setTimeout(() => {
        doCheckForUpdates().catch((error) => {
          updateCheckerLog("Auto-check failed on startup:", error);
        });
      }, STARTUP_CHECK_DELAY_MS);

      return () => clearTimeout(timer);
    }
  }, [autoCheckEnabled, checkFrequency, lastCheckTimestamp, doCheckForUpdates]);

  // Show toast notifications on status changes.
  // Only show toasts for actionable states or manual check feedback.
  // "available" / "downloading" stay silent (StatusBar shows them);
  // "error" toasts only when the user manually triggered the check —
  // background-retry errors stay quiet so a flapping network doesn't pop a
  // notification every few seconds. The "retries exhausted" branch below
  // surfaces a final toast if auto-retry truly gave up.
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Skip initial mount and same-status updates
    if (prevStatus === null || prevStatus === status) return;

    switch (status) {
      case "ready":
        // Actionable: user can restart to apply update
        if (updateInfo) {
          toast.success(i18n.t("dialog:toast.updateReady", { version: updateInfo.version }), {
            duration: 5000,
          });
        }
        break;
      case "up-to-date":
        // Only show if user manually triggered the check
        if (prevStatus === "checking" && isManualCheck.current) {
          toast.success(i18n.t("dialog:toast.updateUpToDate"), {
            duration: 3000,
          });
        }
        isManualCheck.current = false;
        break;
      case "error":
        if (prevStatus === "checking" && isManualCheck.current) {
          const errMsg = useUpdateStore.getState().error;
          // Pin: error messages from the updater can be long (URLs,
          // network details). Users may want to copy them.
          toast.error(
            i18n.t("dialog:toast.updateCheckFailed", {
              error: errMsg ?? i18n.t("dialog:toast.updateCheckFailedGeneric"),
            }),
            { duration: 5000, pin: true },
          );
          isManualCheck.current = false;
        }
        break;
    }
  }, [status, updateInfo]);

  // Auto-retry on error with exponential backoff
  useEffect(() => {
    const prevStatus = prevStatusForRetryRef.current;
    prevStatusForRetryRef.current = status;

    // Reset retry count on successful check
    if (status === "up-to-date" || status === "available") {
      retryCount.current = 0;
    }

    // Retry on error if we haven't exceeded max retries
    if (status === "error" && prevStatus === "checking" && autoCheckEnabled) {
      if (retryCount.current < MAX_RETRIES) {
        // Exponential backoff: 5s, 10s, 20s
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount.current);
        retryCount.current += 1;

        updateCheckerLog(
          `Retry ${retryCount.current}/${MAX_RETRIES} in ${delay / 1000}s`
        );

        retryTimerRef.current = setTimeout(() => {
          doCheckForUpdates().catch((err) => {
            updateCheckerLog("Retry failed:", err);
          });
        }, delay);
      } else {
        updateCheckerLog("Max retries reached, giving up");
        // Surface a final toast so the user knows updates aren't reaching the
        // server — otherwise auto-retry exhaustion is invisible. Pin so the
        // user can read it before dismissing (likely AFK during retries).
        toast.error(i18n.t("dialog:toast.updateRetriesExhausted"), {
          duration: 6000,
          pin: true,
        });
      }
    }

    // Cleanup timer on unmount or status change
    return () => {
      /* v8 ignore next -- @preserve defensive guard: retryTimerRef.current may be null if no retry was scheduled */
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [status, autoCheckEnabled, doCheckForUpdates]);

  // Auto-dismiss if the available version matches skipVersion
  useEffect(() => {
    if (
      status === "available" &&
      updateInfo &&
      skipVersion &&
      updateInfo.version === skipVersion
    ) {
      dismiss();
      clearPendingUpdate();
    }
  }, [status, updateInfo, skipVersion, dismiss]);

  // Auto-download when update is available and autoDownload is enabled
  useEffect(() => {
    if (hasAutoDownloaded.current) return;

    if (
      status === "available" &&
      autoDownload &&
      updateInfo &&
      // Don't auto-download skipped versions
      !(skipVersion && updateInfo.version === skipVersion)
    ) {
      hasAutoDownloaded.current = true;
      doDownloadAndInstall().catch((error) => {
        updateCheckerLog("Auto-download failed:", error);
      });
    }
  }, [status, autoDownload, updateInfo, skipVersion, doDownloadAndInstall]);

  // Reset auto-download flag when status goes back to idle
  useEffect(() => {
    if (status === "idle") {
      hasAutoDownloaded.current = false;
    }
  }, [status]);

  // Listen for check requests from other windows
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_CHECK, () => {
      isManualCheck.current = true;
      doCheckForUpdates().catch((error) => {
        updateCheckerLog("Check request failed:", error);
      });
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, [doCheckForUpdates, EVENTS.REQUEST_CHECK]);

  // Listen for download requests from other windows
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_DOWNLOAD, () => {
      doDownloadAndInstall().catch((error) => {
        updateCheckerLog("Download request failed:", error);
      });
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, [doDownloadAndInstall, EVENTS.REQUEST_DOWNLOAD]);

  // Listen for state requests from other windows - broadcast current state
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_STATE, () => {
      // Trigger a broadcast by getting current state and emitting
      // The useUpdateBroadcast hook will handle the actual broadcast
      // We just need to force a re-emit by touching the store
      const currentState = useUpdateStore.getState();
      // Emit current state directly for immediate response
      emit("update:state-changed", {
        status: currentState.status,
        updateInfo: currentState.updateInfo,
        downloadProgress: currentState.downloadProgress,
        error: currentState.error,
      }).catch((error) => {
        updateCheckerLog("Failed to emit state:", error);
      });
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, [EVENTS.REQUEST_STATE]);

  // Listen for restart request (from Settings page) - capture session and restart
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_RESTART, () => {
      (async () => {
        try {
          const dirtyTabs = useDocumentStore.getState().getAllDirtyDocuments();

          if (dirtyTabs.length === 0) {
            // No unsaved documents - capture session and restart
            await restartWithHotExit();
            return;
          }

          // Ask user for confirmation
          const confirmed = await ask(
            i18n.t("dialog:unsavedChanges.restartUnsaved", { count: dirtyTabs.length }),
            {
              title: i18n.t("dialog:unsavedChanges.title"),
              kind: "info",
              okLabel: i18n.t("dialog:common.restart"),
              cancelLabel: i18n.t("dialog:common.cancel"),
            }
          );

          if (confirmed) {
            // Capture session (including unsaved documents) and restart
            await restartWithHotExit();
          } else {
            // User cancelled - emit event so UI can reset
            await emit("update:restart-cancelled");
          }
        } catch (error) {
          updateCheckerLog("Restart request failed:", error);
          // Emit cancel event on error so UI can reset
          emit("update:restart-cancelled").catch((e) => {
            updateCheckerLog("Failed to emit restart-cancelled:", e);
          });
        }
      })();
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, [EVENTS.REQUEST_RESTART]);
}

// Export for testing
export { shouldCheckNow };
