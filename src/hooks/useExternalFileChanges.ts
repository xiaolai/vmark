/**
 * External File Changes Hook
 *
 * Purpose: Detects and responds to filesystem changes on open documents —
 *   auto-reloads clean docs, prompts for dirty docs, marks deleted files.
 *
 * Pipeline: Rust file watcher → `file:changed` / `file:deleted` event →
 *   this hook → resolveExternalChangeAction() decides policy → auto-reload
 *   or show batched prompt dialog
 *
 * Key decisions:
 *   - Clean documents auto-reload silently (brief toast notification)
 *   - Dirty documents batch into a single dialog to avoid prompt storms
 *   - matchesPendingSave() filters out our own saves echoing back
 *   - Deleted files get isMissing flag (no auto-close — user may want to save)
 *
 * @coordinates-with useWindowFileWatcher.ts — starts/stops the Rust watcher
 * @coordinates-with documentStore.ts — reads dirty state, updates content on reload
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
import { reloadTabFromDisk } from "@/utils/reloadFromDisk";
import { matchesPendingSave } from "@/utils/pendingSaves";
import { getFileName } from "@/utils/paths";

/** Pending dirty file change awaiting user decision */
interface PendingDirtyChange {
  tabId: string;
  filePath: string;
}

/** Debounce window for batching external changes (ms) */
const BATCH_DEBOUNCE_MS = 300;

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

  // Batching state for dirty file changes
  const pendingDirtyChangesRef = useRef<PendingDirtyChange[]>([]);
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingBatchRef = useRef(false);

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
      await reloadTabFromDisk(tabId, filePath);
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
      const dialogButtons = {
        saveAs: "Save As...",
        reload: "Reload",
        keep: "Keep my changes",
      } as const;

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
            yes: dialogButtons.saveAs,
            no: dialogButtons.reload,
            cancel: dialogButtons.keep,
          },
        }
      );

      // With custom buttons, plugin-dialog returns the clicked button label string.
      // With default buttons, it returns 'Yes' | 'No' | 'Cancel' | 'Ok'.
      if ((result === "Yes" || result === dialogButtons.saveAs) && doc) {
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

      if (result === "No" || result === dialogButtons.reload) {
        // User explicitly chose to reload - discard their changes
        try {
          await reloadTabFromDisk(tabId, filePath);
        } catch (error) {
          console.error("[ExternalChange] Failed to reload file:", filePath, error);
          useDocumentStore.getState().markMissing(tabId);
        }
        return;
      }

      // Cancel = keep user's changes - mark as divergent so user knows local differs from disk
      useDocumentStore.getState().markDivergent(tabId);
    },
    []
  );

  // Handle file deletion
  const handleDeletion = useCallback((targetTabId: string) => {
    useDocumentStore.getState().markMissing(targetTabId);
  }, []);

  // Process batched dirty file changes with a single dialog
  const processBatchedChanges = useCallback(async () => {
    const pending = pendingDirtyChangesRef.current;
    if (pending.length === 0 || isProcessingBatchRef.current) return;

    isProcessingBatchRef.current = true;
    pendingDirtyChangesRef.current = [];

    try {
      if (pending.length === 1) {
        // Single file - use the existing single-file dialog
        await handleDirtyChange(pending[0].tabId, pending[0].filePath);
      } else {
        // Multiple files - show batch dialog
        const fileNames = pending.map((p) => getFileName(p.filePath) || "file").join(", ");
        const result = await message(
          `${pending.length} files have been modified externally:\n${fileNames}\n\nWhat would you like to do?`,
          {
            title: "Multiple Files Changed",
            kind: "warning",
            buttons: {
              yes: "Reload All",
              no: "Keep All",
              cancel: "Review Each",
            },
          }
        );

        if (result === "Yes") {
          // Reload all files from disk
          for (const { tabId, filePath } of pending) {
            try {
              await reloadTabFromDisk(tabId, filePath);
            } catch (error) {
              console.error("[ExternalChange] Failed to reload file:", filePath, error);
              useDocumentStore.getState().markMissing(tabId);
            }
          }
        } else if (result === "No") {
          // Keep all local versions - mark as divergent
          for (const { tabId } of pending) {
            useDocumentStore.getState().markDivergent(tabId);
          }
        } else {
          // Review each - process individually
          for (const { tabId, filePath } of pending) {
            await handleDirtyChange(tabId, filePath);
          }
        }
      }
    } finally {
      isProcessingBatchRef.current = false;
    }
  }, [handleDirtyChange]);

  // Queue a dirty file change for batched processing
  const queueDirtyChange = useCallback(
    (tabId: string, filePath: string) => {
      // Add to pending queue
      pendingDirtyChangesRef.current.push({ tabId, filePath });

      // Clear existing timeout and set a new one
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }

      batchTimeoutRef.current = setTimeout(() => {
        batchTimeoutRef.current = null;
        processBatchedChanges();
      }, BATCH_DEBOUNCE_MS);
    },
    [processBatchedChanges]
  );

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

            // Check 2: File reappeared after deletion — always reload and clear missing
            // (e.g. Finder undo, git checkout, Trash restore)
            if (doc.isMissing) {
              useDocumentStore.getState().loadContent(tabId, diskContent, changedPath, detectLinebreaks(diskContent));
              useDocumentStore.getState().clearMissing(tabId);
              toast.info(`Restored: ${getFileName(changedPath)}`);
              continue;
            }

            // Check 3: Does disk match what we last wrote?
            // If so, no actual external change occurred (file was touched but not modified)
            if (diskContent === doc.lastDiskContent) {
              continue;
            }

            // Real external change detected - disk content differs from lastDiskContent
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
                // Queue for batched processing to avoid dialog storms
                queueDirtyChange(tabId, changedPath);
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
      // Clean up batch timeout on unmount
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
        batchTimeoutRef.current = null;
      }
    };
  }, [windowLabel, getOpenFilePaths, handleReload, queueDirtyChange, handleDeletion]);
}
