/**
 * Update Checker Hook
 *
 * Handles automatic update checking on startup based on user settings.
 * Respects check frequency (startup, daily, weekly, manual).
 *
 * Also handles update operation requests from other windows,
 * ensuring all operations run in the main window context.
 */

import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore, type UpdateStatus } from "@/stores/updateStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUpdateOperationHandler, clearPendingUpdate } from "./useUpdateOperations";

// Time constants in milliseconds
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;
const STARTUP_CHECK_DELAY_MS = 2000; // Delay to let app initialize before checking

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
 * Hook to check for updates on startup and handle menu events.
 * Should be used in the main window only.
 */
export function useUpdateChecker() {
  const hasChecked = useRef(false);
  const hasAutoDownloaded = useRef(false);
  const { doCheckForUpdates, doDownloadAndInstall, EVENTS } = useUpdateOperationHandler();

  const autoCheckEnabled = useSettingsStore((state) => state.update.autoCheckEnabled);
  const checkFrequency = useSettingsStore((state) => state.update.checkFrequency);
  const lastCheckTimestamp = useSettingsStore((state) => state.update.lastCheckTimestamp);
  const skipVersion = useSettingsStore((state) => state.update.skipVersion);
  const autoDownload = useSettingsStore((state) => state.update.autoDownload);

  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const error = useUpdateStore((state) => state.error);
  const dismiss = useUpdateStore((state) => state.dismiss);

  // Track previous status for toast notifications
  const prevStatusRef = useRef<UpdateStatus | null>(null);

  // Check for updates on startup if needed
  useEffect(() => {
    if (hasChecked.current) return;

    if (shouldCheckNow(autoCheckEnabled, checkFrequency, lastCheckTimestamp)) {
      hasChecked.current = true;

      const timer = setTimeout(async () => {
        await doCheckForUpdates();
      }, STARTUP_CHECK_DELAY_MS);

      return () => clearTimeout(timer);
    }
  }, [autoCheckEnabled, checkFrequency, lastCheckTimestamp, doCheckForUpdates]);

  // Show toast notifications on status changes
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Skip initial mount and same-status updates
    if (prevStatus === null || prevStatus === status) return;

    switch (status) {
      case "available":
        if (updateInfo) {
          toast.info(`Update available: v${updateInfo.version}`, {
            duration: 5000,
          });
        }
        break;
      case "downloading":
        toast("Downloading update...", {
          duration: 3000,
        });
        break;
      case "ready":
        if (updateInfo) {
          toast.success(`v${updateInfo.version} ready to install`, {
            duration: 5000,
          });
        }
        break;
      case "error":
        if (error) {
          toast.error(`Update check failed: ${error}`, {
            duration: 5000,
          });
        }
        break;
      case "up-to-date":
        // Only show if user manually triggered the check (prevStatus was "checking")
        if (prevStatus === "checking") {
          toast.success("You're up to date!", {
            duration: 3000,
          });
        }
        break;
    }
  }, [status, updateInfo, error]);

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
      doDownloadAndInstall();
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
    const unlistenPromise = listen(EVENTS.REQUEST_CHECK, async () => {
      await doCheckForUpdates();
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [doCheckForUpdates, EVENTS.REQUEST_CHECK]);

  // Listen for download requests from other windows
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_DOWNLOAD, async () => {
      await doDownloadAndInstall();
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [doDownloadAndInstall, EVENTS.REQUEST_DOWNLOAD]);

  // Listen for state requests from other windows - broadcast current state
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_STATE, async () => {
      // Trigger a broadcast by getting current state and emitting
      // The useUpdateBroadcast hook will handle the actual broadcast
      // We just need to force a re-emit by touching the store
      const currentState = useUpdateStore.getState();
      // Emit current state directly for immediate response
      await emit("update:state-changed", {
        status: currentState.status,
        updateInfo: currentState.updateInfo,
        downloadProgress: currentState.downloadProgress,
        error: currentState.error,
      });
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [EVENTS.REQUEST_STATE]);

  // Listen for menu "Check for Updates..." event - opens Settings at Updates section
  // Event payload contains the focused window label from Rust
  useEffect(() => {
    const unlistenPromise = listen<string>("menu:check-updates", async (event) => {
      const settingsWidth = 760;
      const settingsHeight = 540;

      // Calculate centered position based on the window that triggered the menu
      const calculateCenteredPosition = async (): Promise<{ x: number; y: number } | null> => {
        try {
          const sourceWindow = await WebviewWindow.getByLabel(event.payload);
          if (!sourceWindow) return null;
          const scaleFactor = await sourceWindow.scaleFactor();
          const [position, size] = await Promise.all([
            sourceWindow.outerPosition(),
            sourceWindow.outerSize(),
          ]);
          const x = Math.round(position.x / scaleFactor + (size.width / scaleFactor - settingsWidth) / 2);
          const y = Math.round(position.y / scaleFactor + (size.height / scaleFactor - settingsHeight) / 2);
          return { x, y };
        } catch {
          return null;
        }
      };

      // If Settings exists, reposition, navigate, and focus
      const existing = await WebviewWindow.getByLabel("settings");
      if (existing) {
        const pos = await calculateCenteredPosition();
        if (pos) {
          await existing.setPosition(new LogicalPosition(pos.x, pos.y));
        }
        await existing.setFocus();
        await emit("settings:navigate", "updates");
        return;
      }

      // Create new Settings window
      const pos = await calculateCenteredPosition();
      new WebviewWindow("settings", {
        url: "/settings?section=updates",
        title: "Settings",
        width: settingsWidth,
        height: settingsHeight,
        minWidth: 600,
        minHeight: 400,
        x: pos?.x,
        y: pos?.y,
        center: !pos,
        resizable: true,
        titleBarStyle: "overlay" as const,
        hiddenTitle: true,
      });
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Listen for restart request (from Settings page) - check dirty files first
  useEffect(() => {
    const unlistenPromise = listen(EVENTS.REQUEST_RESTART, async () => {
      const dirtyTabs = useDocumentStore.getState().getAllDirtyDocuments();

      if (dirtyTabs.length === 0) {
        // No unsaved documents - restart immediately
        await relaunch();
        return;
      }

      // Ask user for confirmation
      const confirmed = await ask(
        `You have ${dirtyTabs.length} unsaved document(s). Restart without saving?`,
        {
          title: "Unsaved Changes",
          kind: "warning",
          okLabel: "Restart",
          cancelLabel: "Cancel",
        }
      );

      if (confirmed) {
        await relaunch();
      } else {
        // User cancelled - emit event so UI can reset
        await emit("update:restart-cancelled");
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [EVENTS.REQUEST_RESTART]);
}

// Export for testing
export { shouldCheckNow };
