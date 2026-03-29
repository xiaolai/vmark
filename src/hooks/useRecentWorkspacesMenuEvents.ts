/**
 * Recent Workspaces Menu Events Hook
 *
 * Purpose: Handles native menu events for the "Open Recent Workspace" submenu —
 *   opens a recently used workspace and restores its tabs.
 *
 * Key decisions:
 *   - Verifies workspace directory exists before opening
 *   - Prompts user if workspace folder is missing
 *   - Restores lastOpenTabs from workspace config
 *
 * @coordinates-with recentWorkspacesStore.ts — reads/clears recent workspaces
 * @coordinates-with openWorkspaceWithConfig.ts — loads workspace + config
 * @module hooks/useRecentWorkspacesMenuEvents
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useRecentWorkspacesStore } from "@/stores/recentWorkspacesStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import i18n from "@/i18n";
import { workspaceWarn } from "@/utils/debug";

/** Hook that handles native menu events for the "Open Recent Workspace" submenu. */
export function useRecentWorkspacesMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Clear Recent Workspaces
      const unlistenClearRecent = await currentWindow.listen<string>(
        "menu:clear-recent-workspaces",
        async (event) => {
          if (event.payload !== windowLabel) return;

          const { workspaces } = useRecentWorkspacesStore.getState();
          if (workspaces.length === 0) return;

          await withReentryGuard(windowLabel, "clear-recent-workspaces", async () => {
            const confirmed = await ask(
              i18n.t("dialog:clearRecentWorkspaces.message"),
              {
                title: i18n.t("dialog:clearRecentWorkspaces.title"),
                kind: "warning",
              }
            );
            if (confirmed) {
              useRecentWorkspacesStore.getState().clearAll();
            }
          });
        }
      );
      if (cancelled) { unlistenClearRecent(); return; }
      unlistenRefs.current.push(unlistenClearRecent);

      // Open Recent Workspace
      // Payload is (path, windowLabel) - path from Rust snapshot prevents race conditions
      const unlistenOpenRecent = await currentWindow.listen<[string, string]>(
        "menu:open-recent-workspace",
        async (event) => {
          const [workspacePath, targetLabel] = event.payload;
          if (targetLabel !== windowLabel) return;

          await withReentryGuard(windowLabel, "open-recent-workspace", async () => {
            // Check if workspace directory exists
            const pathExists = await exists(workspacePath);
            if (!pathExists) {
              const remove = await ask(
                i18n.t("dialog:workspaceNotFound.message"),
                { title: i18n.t("dialog:workspaceNotFound.title"), kind: "warning" }
              );
              if (remove) {
                useRecentWorkspacesStore.getState().removeWorkspace(workspacePath);
              }
              return;
            }

            // Check if current window has dirty tabs
            const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
            const dirtyTabs = tabs.filter((tab) => {
              const doc = useDocumentStore.getState().getDocument(tab.id);
              return doc?.isDirty;
            });

            if (dirtyTabs.length > 0) {
              const confirmed = await ask(
                i18n.t("dialog:unsavedChanges.openInNewWindow"),
                {
                  title: i18n.t("dialog:unsavedChanges.title"),
                  kind: "warning",
                  okLabel: "Open in New Window",
                  cancelLabel: "Cancel",
                }
              );
              if (confirmed) {
                await invoke("open_workspace_in_new_window", {
                  workspaceRoot: workspacePath,
                  filePath: null,
                });
              }
              return;
            }

            // Open workspace and restore tabs
            const existing = await openWorkspaceWithConfig(workspacePath);
            useUIStore.getState().showSidebarWithView("files");

            // Restore tabs from lastOpenTabs if available
            if (existing?.lastOpenTabs && existing.lastOpenTabs.length > 0) {
              for (const filePath of existing.lastOpenTabs) {
                try {
                  const content = await readTextFile(filePath);
                  const tabId = useTabStore.getState().createTab(windowLabel, filePath);
                  useDocumentStore.getState().initDocument(tabId, content, filePath);
                  useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
                } catch {
                  workspaceWarn(`Could not restore tab: ${filePath}`);
                }
              }
            }

            // Add to recent workspaces (moves to top if already exists)
            useRecentWorkspacesStore.getState().addWorkspace(workspacePath);
          });
        }
      );
      if (cancelled) { unlistenOpenRecent(); return; }
      unlistenRefs.current.push(unlistenOpenRecent);
    };

    setupListeners().catch((error) => {
      workspaceWarn("Failed to setup recent workspaces listeners:", error);
    });

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
