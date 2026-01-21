import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { clearAllHistory } from "@/hooks/useHistoryRecovery";
import { historyLog } from "@/utils/debug";
import { withReentryGuard } from "@/utils/reentryGuard";
import { runOrphanCleanup } from "@/utils/orphanAssetCleanup";

/**
 * Handles miscellaneous menu events: preferences, history, and cleanup.
 * View menu and recent files events are handled by separate hooks.
 */
export function useMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Preferences
      const unlistenPreferences = await currentWindow.listen<string>("menu:preferences", async (event) => {
        if (event.payload !== windowLabel) return;
        const existing = await WebviewWindow.getByLabel("settings");
        if (existing) {
          await existing.setFocus();
          return;
        }
        new WebviewWindow("settings", {
          url: "/settings",
          title: "Settings",
          width: 700,
          height: 500,
          minWidth: 500,
          minHeight: 400,
          center: true,
          resizable: true,
          hiddenTitle: true,
          titleBarStyle: "overlay",
        });
      });
      if (cancelled) { unlistenPreferences(); return; }
      unlistenRefs.current.push(unlistenPreferences);

      // View History
      const unlistenViewHistory = await currentWindow.listen<string>("menu:view-history", (event) => {
        if (event.payload !== windowLabel) return;
        useUIStore.getState().showSidebarWithView("history");
      });
      if (cancelled) { unlistenViewHistory(); return; }
      unlistenRefs.current.push(unlistenViewHistory);

      // Clear History
      const unlistenClearHistory = await currentWindow.listen<string>("menu:clear-history", async (event) => {
        if (event.payload !== windowLabel) return;

        await withReentryGuard(windowLabel, "clear-history", async () => {
          const confirmed = await ask(
            "This will permanently delete all document history. This action cannot be undone.",
            {
              title: "Clear All History",
              kind: "warning",
            }
          );
          if (confirmed) {
            try {
              await clearAllHistory();
              historyLog("All history cleared");
            } catch (error) {
              console.error("[History] Failed to clear history:", error);
            }
          }
        });
      });
      if (cancelled) { unlistenClearHistory(); return; }
      unlistenRefs.current.push(unlistenClearHistory);

      // Clean up unused images
      const unlistenCleanupImages = await currentWindow.listen<string>("menu:cleanup-images", async (event) => {
        if (event.payload !== windowLabel) return;

        await withReentryGuard(windowLabel, "cleanup-images", async () => {
          const tabId = useTabStore.getState().activeTabId[windowLabel];
          if (!tabId) return;

          const doc = useDocumentStore.getState().getDocument(tabId);
          if (!doc) return;

          const { useSettingsStore } = await import("@/stores/settingsStore");
          const autoCleanupEnabled = useSettingsStore.getState().image.cleanupOrphansOnClose;

          await runOrphanCleanup(doc.filePath, doc.isDirty ? null : doc.content, autoCleanupEnabled);
        });
      });
      if (cancelled) { unlistenCleanupImages(); return; }
      unlistenRefs.current.push(unlistenCleanupImages);
    };

    setupListeners().catch((error) => {
      console.error("[useMenuEvents] Failed to setup listeners:", error);
    });

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
