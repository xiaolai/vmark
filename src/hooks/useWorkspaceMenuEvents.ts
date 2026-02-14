import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentWorkspacesStore } from "@/stores/recentWorkspacesStore";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { safeUnlistenAll } from "@/utils/safeUnlisten";

/**
 * Hook to handle workspace-related menu events
 * Extracted from useMenuEvents to keep file under 300 lines
 */
export function useWorkspaceMenuEvents() {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Open Workspace
      const unlistenOpenFolder = await currentWindow.listen<string>("menu:open-folder", async (event) => {
        if (event.payload !== windowLabel) return;
        try {
          // Use JS dialog API directly - supports both files and folders
          const selected = await open({
            directory: true,
            multiple: false,
            canCreateDirectories: true,
            title: "Open Workspace Folder",
          });
          if (!selected) return;
          const path = typeof selected === "string" ? selected : selected[0];
          if (!path) return;

          const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
          const dirtyTabs = tabs.filter((tab) => {
            const doc = useDocumentStore.getState().getDocument(tab.id);
            return doc?.isDirty;
          });

          if (dirtyTabs.length > 0) {
            const confirmed = await ask(
              "This window has unsaved changes. Open the workspace in a new window instead?",
              {
                title: "Unsaved Changes",
                kind: "warning",
                okLabel: "Open in New Window",
                cancelLabel: "Cancel",
              }
            );
            if (confirmed) {
              await invoke("open_workspace_in_new_window", {
                workspaceRoot: path,
                filePath: null,
              });
            }
            return;
          }

          const existing = await openWorkspaceWithConfig(path);
          // Show sidebar with files view
          useUIStore.getState().showSidebarWithView("files");
          // Add to recent workspaces
          useRecentWorkspacesStore.getState().addWorkspace(path);

          // Restore tabs from lastOpenTabs if available
          if (existing?.lastOpenTabs && existing.lastOpenTabs.length > 0) {
            for (const filePath of existing.lastOpenTabs) {
              try {
                const content = await readTextFile(filePath);
                const tabId = useTabStore.getState().createTab(windowLabel, filePath);
                useDocumentStore.getState().initDocument(tabId, content, filePath);
                useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
              } catch {
                // File may have been moved/deleted - skip it
                console.warn(`[Workspace] Could not restore tab: ${filePath}`);
              }
            }
          }
        } catch (error) {
          console.error("Failed to open folder:", error);
        }
      });
      if (cancelled) {
        unlistenOpenFolder();
        return;
      }
      unlistenRefs.current.push(unlistenOpenFolder);

      // Close Workspace - save open tabs before closing
      const unlistenCloseWorkspace = await currentWindow.listen<string>(
        "menu:close-workspace",
        async (event) => {
          if (event.payload !== windowLabel) return;
          await persistWorkspaceSession(windowLabel);
          useWorkspaceStore.getState().closeWorkspace();
        }
      );
      if (cancelled) {
        unlistenCloseWorkspace();
        return;
      }
      unlistenRefs.current.push(unlistenCloseWorkspace);
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
