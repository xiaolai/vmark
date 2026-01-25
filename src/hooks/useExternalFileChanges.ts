/**
 * Hook for handling external file changes
 *
 * Listens to file system change events and applies the policy:
 * - Clean documents: auto-reload with brief notification
 * - Dirty documents: prompt user to choose
 * - Deleted files: mark as missing
 *
 * @module hooks/useExternalFileChanges
 */
import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { message, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { resolveExternalChangeAction } from "@/utils/openPolicy";
import { normalizePath } from "@/utils/paths";
import { saveToPath } from "@/utils/saveToPath";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { matchesPendingSave } from "@/utils/pendingSaves";
import { getFileName } from "@/utils/paths";

interface FsChangeEvent {
  watchId: string;
  rootPath: string;
  paths: string[];
  kind: "create" | "modify" | "remove" | "rename";
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
      useDocumentStore.getState().loadContent(tabId, content, filePath, detectLinebreaks(content));
      useDocumentStore.getState().clearMissing(tabId);
    } catch (error) {
      console.error("[ExternalChange] Failed to reload file:", filePath, error);
      // File might have been deleted - mark as missing
      useDocumentStore.getState().markMissing(tabId);
    }
  }, []);

  // Handle dirty file change with single 3-option dialog
  // Options: Save As (save to new location), Reload (discard changes), Keep (preserve)
  // Cancel/dismiss preserves user's changes (safe default)
  const handleDirtyChange = useCallback(
    async (tabId: string, filePath: string) => {
      const fileName = getFileName(filePath) || "file";
      const doc = useDocumentStore.getState().getDocument(tabId);

      // Single dialog with 3 options:
      // Yes = "Save As..." (save current version to new location)
      // No = "Reload" (discard changes and load from disk)
      // Cancel = "Keep my changes" (do nothing, preserve user's work)
      const result = await message(
        `"${fileName}" has been modified externally.\n\n` +
          "What would you like to do?",
        {
          title: "File Changed",
          kind: "warning",
          buttons: {
            yes: "Save As...",
            no: "Reload",
            cancel: "Keep my changes",
          },
        }
      );

      if (result === "Yes" && doc) {
        // Open Save As dialog
        const savePath = await save({
          title: "Save your version as...",
          defaultPath: filePath,
          filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        });

        if (savePath) {
          const saved = await saveToPath(tabId, savePath, doc.content, "manual");
          if (saved) {
            useDocumentStore.getState().clearMissing(tabId);
            // Save As switches the document to the new path; done.
            return;
          }
        }
        // If Save As was cancelled or failed, don't reload - keep user's changes
        return;
      }

      if (result === "No") {
        // User explicitly chose to reload - discard their changes
        try {
          const content = await readTextFile(filePath);
          useDocumentStore.getState().loadContent(tabId, content, filePath, detectLinebreaks(content));
          // Clear missing flag in case file was previously deleted and recreated
          useDocumentStore.getState().clearMissing(tabId);
        } catch (error) {
          console.error("[ExternalChange] Failed to reload file:", filePath, error);
          useDocumentStore.getState().markMissing(tabId);
        }
        return;
      }

      // Cancel = keep user's changes (safe default, no action needed)
    },
    []
  );

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

        const { kind, paths, watchId } = event.payload;

        // Only process events from this window's watcher (scoped by windowLabel)
        if (watchId !== windowLabel) return;

        const openPaths = getOpenFilePaths();

        if (kind === "rename") {
          let handled = false;
          for (let i = 0; i + 1 < paths.length; i += 2) {
            const oldPath = normalizePath(paths[i]);
            const newPath = normalizePath(paths[i + 1]);
            const tabId = openPaths.get(oldPath);
            if (!tabId) continue;

            useTabStore.getState().updateTabPath(tabId, newPath);
            useDocumentStore.getState().setFilePath(tabId, newPath);
            useDocumentStore.getState().clearMissing(tabId);
            handled = true;
          }
          if (!handled) {
            for (const changedPath of paths) {
              const normalizedPath = normalizePath(changedPath);
              const tabId = openPaths.get(normalizedPath);
              if (tabId) {
                handleDeletion(tabId);
              }
            }
          }
          return;
        }

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
            // Content-based verification: read file and compare
            // This eliminates false positives from file touches, sync services, etc.
            let diskContent: string;
            try {
              diskContent = await readTextFile(changedPath);
            } catch {
              // File unreadable (might be deleted or locked) - skip
              continue;
            }

            // Check 1: Is this our own pending save?
            // If disk content matches what we're writing, it's our save
            if (matchesPendingSave(changedPath, diskContent)) {
              continue;
            }

            // Check 2: Does disk match our last saved content?
            // If so, no actual external change occurred (file was touched but not modified)
            if (diskContent === doc.savedContent) {
              continue;
            }

            // Real external change detected - disk content differs from savedContent
            const action = resolveExternalChangeAction({
              isDirty: doc.isDirty,
              hasFilePath: Boolean(doc.filePath),
            });

            switch (action) {
              case "auto_reload":
                // Clean document - reload with brief notification
                useDocumentStore.getState().loadContent(tabId, diskContent, changedPath, detectLinebreaks(diskContent));
                useDocumentStore.getState().clearMissing(tabId);
                toast.info(`Reloaded: ${getFileName(changedPath)}`);
                break;
              case "prompt_user":
                await handleDirtyChange(tabId, changedPath);
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
