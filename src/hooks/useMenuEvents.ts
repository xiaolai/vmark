/**
 * Menu Events Hook
 *
 * Purpose: Handles miscellaneous menu events not covered by specialized hooks —
 *   settings, orphan cleanup, history clear (all + workspace), reveal in Finder,
 *   open links, and other utility menu actions.
 *
 * @coordinates-with useFileOperations.ts — file-related menu events
 * @coordinates-with useViewMenuEvents.ts — view-related menu events
 * @coordinates-with useWorkspaceMenuEvents.ts — workspace-related menu events
 * @module hooks/useMenuEvents
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { clearAllHistory, clearWorkspaceHistory } from "@/hooks/useHistoryRecovery";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { historyLog } from "@/utils/debug";
import { withReentryGuard } from "@/utils/reentryGuard";
import { runOrphanCleanup } from "@/utils/orphanAssetCleanup";
import { openSettingsWindow } from "@/utils/settingsWindow";
import { safeUnlistenAll } from "@/utils/safeUnlisten";

const HELP_URL = "https://vmark.app/guide/";
const SHORTCUTS_URL = "https://vmark.app/guide/shortcuts";
const REPORT_ISSUE_URL = "https://github.com/xiaolai/vmark/issues/new";

/**
 * Handles miscellaneous menu events: preferences, history, and cleanup.
 * View menu and recent files events are handled by separate hooks.
 */
export function useMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Preferences - open Settings centered on this window
      const unlistenPreferences = await currentWindow.listen<string>("menu:preferences", async (event) => {
        if (event.payload !== windowLabel) return;
        await openSettingsWindow();
      });
      if (cancelled) { unlistenPreferences(); return; }
      unlistenRefs.current.push(unlistenPreferences);

      // Clear All History
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
              window.dispatchEvent(new CustomEvent("vmark:history-cleared"));
            } catch (error) {
              console.error("[History] Failed to clear history:", error);
            }
          }
        });
      });
      if (cancelled) { unlistenClearHistory(); return; }
      unlistenRefs.current.push(unlistenClearHistory);

      // Clear Workspace History
      const unlistenClearWorkspaceHistory = await currentWindow.listen<string>(
        "menu:clear-workspace-history",
        async (event) => {
          if (event.payload !== windowLabel) return;

          await withReentryGuard(windowLabel, "clear-workspace-history", async () => {
            const { rootPath } = useWorkspaceStore.getState();
            if (!rootPath) return;

            const workspaceName = rootPath.split("/").pop() || rootPath;
            const confirmed = await ask(
              `Delete history for all documents in workspace "${workspaceName}"?\nThis cannot be undone.`,
              { title: "Clear Workspace History", kind: "warning" }
            );
            if (confirmed) {
              const count = await clearWorkspaceHistory(rootPath);
              historyLog(`Cleared workspace history: ${count} document(s)`);
              window.dispatchEvent(new CustomEvent("vmark:history-cleared"));
            }
          });
        }
      );
      if (cancelled) { unlistenClearWorkspaceHistory(); return; }
      unlistenRefs.current.push(unlistenClearWorkspaceHistory);

      // Clean up unused images
      const unlistenCleanupImages = await currentWindow.listen<string>("menu:cleanup-images", async (event) => {
        if (event.payload !== windowLabel) return;

        await withReentryGuard(windowLabel, "cleanup-images", async () => {
          const tabId = useTabStore.getState().activeTabId[windowLabel];
          if (!tabId) return;

          const doc = useDocumentStore.getState().getDocument(tabId);
          if (!doc) return;

          const autoCleanupEnabled = useSettingsStore.getState().image.cleanupOrphansOnClose;

          await runOrphanCleanup(doc.filePath, doc.isDirty ? null : doc.content, autoCleanupEnabled);
        });
      });
      if (cancelled) { unlistenCleanupImages(); return; }
      unlistenRefs.current.push(unlistenCleanupImages);

      // Help menu items
      const unlistenVMarkHelp = await currentWindow.listen<string>("menu:vmark-help", async (event) => {
        if (event.payload !== windowLabel) return;
        await openUrl(HELP_URL);
      });
      if (cancelled) { unlistenVMarkHelp(); return; }
      unlistenRefs.current.push(unlistenVMarkHelp);

      const unlistenKeyboardShortcuts = await currentWindow.listen<string>("menu:keyboard-shortcuts", async (event) => {
        if (event.payload !== windowLabel) return;
        await openUrl(SHORTCUTS_URL);
      });
      if (cancelled) { unlistenKeyboardShortcuts(); return; }
      unlistenRefs.current.push(unlistenKeyboardShortcuts);

      const unlistenReportIssue = await currentWindow.listen<string>("menu:report-issue", async (event) => {
        if (event.payload !== windowLabel) return;
        await openUrl(REPORT_ISSUE_URL);
      });
      if (cancelled) { unlistenReportIssue(); return; }
      unlistenRefs.current.push(unlistenReportIssue);

      // Open Genies Folder
      const unlistenOpenGeniesFolder = await currentWindow.listen<string>("menu:open-genies-folder", async (event) => {
        if (event.payload !== windowLabel) return;
        try {
          const dir = await invoke<string>("get_genies_dir");
          await mkdir(dir, { recursive: true });
          await revealItemInDir(dir);
        } catch (error) {
          console.error("[Menu] Failed to open genies folder:", error);
        }
      });
      if (cancelled) { unlistenOpenGeniesFolder(); return; }
      unlistenRefs.current.push(unlistenOpenGeniesFolder);
    };

    setupListeners().catch((error) => {
      console.error("[useMenuEvents] Failed to setup listeners:", error);
    });

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
