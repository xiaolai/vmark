/**
 * Hook for handling files opened from Finder (double-click, "Open With", etc.)
 *
 * When a file is opened from Finder while the app is already running,
 * Rust emits an `app:open-file` event. This hook handles that event:
 * - If the current tab is empty (untitled, no content), load the file there
 * - Otherwise, open the file in a new window
 *
 * @module hooks/useFinderFileOpen
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";

interface OpenFilePayload {
  path: string;
  workspace_root: string | null;
}

/**
 * Hook to handle files opened from Finder.
 *
 * When the user opens a markdown file from Finder (double-click or "Open With"),
 * and the app is already running, this hook receives the file path and:
 * 1. Checks if there's an existing tab for this file -> activates it
 * 2. Checks if there's an empty (replaceable) tab -> loads file there
 * 3. Otherwise -> opens file in a new window
 *
 * This prevents the "two windows" issue when opening files from Finder.
 */
export function useFinderFileOpen(): void {
  const windowLabel = useWindowLabel();

  useEffect(() => {
    // Only the main window handles Finder file opens initially
    // (Rust emits to main window specifically)
    if (windowLabel !== "main") {
      return;
    }

    const handleOpenFile = async (event: { payload: OpenFilePayload }) => {
      const { path, workspace_root: workspaceRoot } = event.payload;

      // Check if file is already open in a tab
      const existingTabId = findExistingTabForPath(windowLabel, path);
      if (existingTabId) {
        useTabStore.getState().setActiveTab(windowLabel, existingTabId);
        return;
      }

      // Check if there's a replaceable (empty) tab
      const replaceableTab = getReplaceableTab(windowLabel);

      if (replaceableTab) {
        // Load file into the empty tab
        try {
          const content = await readTextFile(path);

          // Set up workspace if provided
          if (workspaceRoot) {
            await openWorkspaceWithConfig(workspaceRoot);
          }

          // Update tab and document
          useTabStore.getState().updateTabPath(replaceableTab.tabId, path);
          useDocumentStore.getState().loadContent(
            replaceableTab.tabId,
            content,
            path,
            detectLinebreaks(content)
          );
          useRecentFilesStore.getState().addFile(path);
        } catch (error) {
          console.error("[FinderFileOpen] Failed to load file:", path, error);
        }
      } else {
        // No replaceable tab - open in new window
        try {
          if (workspaceRoot) {
            await invoke("open_workspace_in_new_window", {
              workspaceRoot,
              filePath: path,
            });
          } else {
            await invoke("open_file_in_new_window", { path });
          }
        } catch (error) {
          console.error("[FinderFileOpen] Failed to open in new window:", path, error);
        }
      }
    };

    const unlistenPromise = listen<OpenFilePayload>("app:open-file", handleOpenFile);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [windowLabel]);
}
