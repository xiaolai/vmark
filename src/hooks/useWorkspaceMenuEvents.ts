import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";

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
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Open Folder
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

          // Try to read existing config
          const existing = await invoke<WorkspaceConfig | null>(
            "read_workspace_config",
            { rootPath: path }
          );
          useWorkspaceStore.getState().openWorkspace(path, existing);
          // Show sidebar with files view
          useUIStore.getState().showSidebarWithView("files");

          // Restore tabs from lastOpenTabs if available
          if (existing?.lastOpenTabs && existing.lastOpenTabs.length > 0) {
            for (const filePath of existing.lastOpenTabs) {
              try {
                const content = await readTextFile(filePath);
                const tabId = useTabStore.getState().createTab(windowLabel, filePath);
                useDocumentStore.getState().initDocument(tabId, content, filePath);
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
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
