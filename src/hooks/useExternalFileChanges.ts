/**
 * Hook for handling external file changes
 *
 * Listens to file system change events and applies the policy:
 * - Clean documents: auto-reload silently
 * - Dirty documents: prompt user to choose
 * - Deleted files: mark as missing
 *
 * @module hooks/useExternalFileChanges
 */
import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { message } from "@tauri-apps/plugin-dialog";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { resolveExternalChangeAction } from "@/utils/openPolicy";
import { normalizePath } from "@/utils/paths";

interface FsChangeEvent {
  watchId: string;
  rootPath: string;
  paths: string[];
  kind: "create" | "modify" | "remove";
}

/**
 * Hook to handle external file changes for documents in the current window.
 *
 * Policy:
 * - Clean docs auto-reload without prompt
 * - Dirty docs prompt with options: Keep current, Reload from disk
 * - Deleted files are marked as missing
 */
export function useExternalFileChanges(): void {
  const windowLabel = useWindowLabel();
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Get tabs and their file paths for the current window
  const getOpenFilePaths = useCallback(() => {
    const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
    const pathToTabId = new Map<string, string>();

    for (const tab of tabs) {
      const doc = useDocumentStore.getState().getDocument(tab.id);
      if (doc?.filePath) {
        pathToTabId.set(normalizePath(doc.filePath), tab.id);
      }
    }

    return pathToTabId;
  }, [windowLabel]);

  // Handle reload for a specific tab
  const handleReload = useCallback(async (tabId: string, filePath: string) => {
    try {
      const content = await readTextFile(filePath);
      useDocumentStore.getState().loadContent(tabId, content, filePath);
      useDocumentStore.getState().clearMissing(tabId);
    } catch (error) {
      console.error("[ExternalChange] Failed to reload file:", filePath, error);
      // File might have been deleted - mark as missing
      useDocumentStore.getState().markMissing(tabId);
    }
  }, []);

  // Handle dirty file change - prompt user
  const handleDirtyChange = useCallback(async (filePath: string) => {
    const fileName = filePath.split("/").pop() || "file";

    // Use a simple message dialog for now
    // In the future, this could be a custom modal with more options
    await message(
      `"${fileName}" has been modified externally.\n\n` +
        "Your changes have been preserved. Use Save As to keep your version, " +
        "or close and reopen the file to load the disk version.",
      { title: "File Changed", kind: "warning" }
    );

    // Mark as needing attention but don't auto-reload dirty docs
    // User keeps their current changes
  }, []);

  // Handle file deletion
  const handleDeletion = useCallback((targetTabId: string) => {
    useDocumentStore.getState().markMissing(targetTabId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setupListener = async () => {
      if (cancelled) return;

      const unlisten = await listen<FsChangeEvent>("fs:changed", async (event) => {
        if (cancelled) return;

        const { kind, paths } = event.payload;
        const openPaths = getOpenFilePaths();

        for (const changedPath of paths) {
          const normalizedPath = normalizePath(changedPath);
          const tabId = openPaths.get(normalizedPath);

          if (!tabId) continue; // Not an open file

          const doc = useDocumentStore.getState().getDocument(tabId);
          if (!doc) continue;

          // Handle file deletion
          if (kind === "remove") {
            handleDeletion(tabId);
            continue;
          }

          // Handle file modification (create could be a recreation after delete)
          if (kind === "modify" || kind === "create") {
            const action = resolveExternalChangeAction({
              isDirty: doc.isDirty,
              hasFilePath: Boolean(doc.filePath),
            });

            switch (action) {
              case "auto_reload":
                await handleReload(tabId, changedPath);
                break;
              case "prompt_user":
                await handleDirtyChange(changedPath);
                break;
              case "no_op":
                // Should not happen for files with paths
                break;
            }
          }
        }
      });

      if (cancelled) {
        unlisten();
        return;
      }

      unlistenRef.current = unlisten;
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [windowLabel, getOpenFilePaths, handleReload, handleDirtyChange, handleDeletion]);
}
