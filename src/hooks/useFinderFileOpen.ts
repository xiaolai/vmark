/**
 * Hook for handling files opened from Finder (double-click, "Open With", etc.)
 *
 * When a file is opened from Finder while the app is already running,
 * Rust emits an `app:open-file` event. This hook handles that event:
 * - If the current tab is empty (untitled, no content), load the file there
 * - Otherwise, open the file in a new window
 *
 * Also handles cold start files queued during app launch before React mounted.
 *
 * @module hooks/useFinderFileOpen
 */
import { useEffect, useRef } from "react";
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

/** Payload from Rust's pending file queue (uses snake_case) */
interface PendingFileOpen {
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
 * Also fetches any pending files queued during cold start.
 *
 * This prevents the "two windows" issue when opening files from Finder.
 */
export function useFinderFileOpen(): void {
  const windowLabel = useWindowLabel();
  // Guard against StrictMode double-execution
  const pendingFetchedRef = useRef(false);

  useEffect(() => {
    // Only the main window handles Finder file opens initially
    // (Rust emits to main window specifically)
    if (windowLabel !== "main") {
      return;
    }

    /**
     * Process a file open request (from event or pending queue)
     */
    const processFileOpen = async (path: string, workspaceRoot: string | null) => {
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

    const handleOpenFile = async (event: { payload: OpenFilePayload }) => {
      const { path, workspace_root: workspaceRoot } = event.payload;
      await processFileOpen(path, workspaceRoot);
    };

    /**
     * Fetch and process any files queued during cold start.
     * This handles the race condition where Finder opens a file before React mounts.
     */
    const fetchPendingFiles = async () => {
      if (pendingFetchedRef.current) return;
      pendingFetchedRef.current = true;

      try {
        const pending = await invoke<PendingFileOpen[]>("get_pending_file_opens");
        for (const file of pending) {
          await processFileOpen(file.path, file.workspace_root);
        }
      } catch (error) {
        console.error("[FinderFileOpen] Failed to fetch pending files:", error);
      }
    };

    // Fetch pending files on mount
    fetchPendingFiles();

    // Listen for new file opens
    const unlistenPromise = listen<OpenFilePayload>("app:open-file", handleOpenFile);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [windowLabel]);
}
