/**
 * Update Checker Hook
 *
 * Handles automatic update checking on startup based on user settings.
 * Respects check frequency (startup, daily, weekly, manual).
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUpdateOperations } from "./useUpdateOperations";

// Time constants in milliseconds
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

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
  const { checkForUpdates } = useUpdateOperations();

  const autoCheckEnabled = useSettingsStore((state) => state.update.autoCheckEnabled);
  const checkFrequency = useSettingsStore((state) => state.update.checkFrequency);
  const lastCheckTimestamp = useSettingsStore((state) => state.update.lastCheckTimestamp);
  const skipVersion = useSettingsStore((state) => state.update.skipVersion);

  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const dismiss = useUpdateStore((state) => state.dismiss);

  // Check for updates on startup if needed
  useEffect(() => {
    if (hasChecked.current) return;

    if (shouldCheckNow(autoCheckEnabled, checkFrequency, lastCheckTimestamp)) {
      hasChecked.current = true;

      // Delay slightly to let the app initialize
      const timer = setTimeout(async () => {
        await checkForUpdates();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [autoCheckEnabled, checkFrequency, lastCheckTimestamp, checkForUpdates]);

  // Auto-dismiss if the available version matches skipVersion
  useEffect(() => {
    if (
      status === "available" &&
      updateInfo &&
      skipVersion &&
      updateInfo.version === skipVersion
    ) {
      dismiss();
    }
  }, [status, updateInfo, skipVersion, dismiss]);

  // Listen for menu "Check for Updates..." event - opens Settings at Updates section
  useEffect(() => {
    const unlistenPromise = listen<string>("menu:check-updates", async () => {
      // Open Settings window at Updates section
      const existing = await WebviewWindow.getByLabel("settings");
      if (existing) {
        await existing.setFocus();
        // Note: Can't navigate existing window to different URL, but user can click Updates
        return;
      }
      new WebviewWindow("settings", {
        url: "/settings?section=updates",
        title: "Settings",
        width: 760,
        height: 540,
        minWidth: 600,
        minHeight: 400,
        resizable: true,
        center: true,
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
    const unlistenPromise = listen("app:restart-for-update", async () => {
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
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);
}

// Export for testing
export { shouldCheckNow };
