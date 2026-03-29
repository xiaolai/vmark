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
 *   - Rename fallback verifies file existence before marking as deleted —
 *     prevents false-positive "file deleted" on atomic write renames
 *   - handleModifyEvent() is shared by modify/create and rename-fallback
 *   - Deleted files get isMissing flag (no auto-close — user may want to save)
 *   - Divergent docs auto-recover when disk content matches editor content —
 *     e.g. git checkout restoring the same content the user has locally
 *
 * @coordinates-with useWindowFileWatcher.ts — starts/stops the Rust watcher
 * @coordinates-with documentStore.ts — reads dirty state, updates content on reload
 * @module hooks/useExternalFileChanges
 */
import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { message, save } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { resolveExternalChangeAction } from "@/utils/openPolicy";
import { normalizePath } from "@/utils/paths";
import { saveToPath } from "@/utils/saveToPath";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { reloadTabFromDisk } from "@/utils/reloadFromDisk";
import { matchesPendingSave, hasPendingSave } from "@/utils/pendingSaves";
import { getFileName } from "@/utils/paths";
import { fileOpsError } from "@/utils/debug";

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

  // Handle dirty file change with single 3-option dialog
  // Options: Save As (save to new location), Reload (discard changes), Keep (preserve)
  // Cancel/dismiss preserves user's changes (safe default)
  const handleDirtyChange = useCallback(
    async (tabId: string, filePath: string) => {
      const dialogButtons = {
        saveAs: i18n.t("dialog:fileChanged.buttonSaveAs"),
        reload: i18n.t("dialog:fileChanged.buttonReload"),
        keep: i18n.t("dialog:fileChanged.buttonKeep"),
      } as const;

      const fileName = getFileName(filePath) || "file";
      const doc = useDocumentStore.getState().getDocument(tabId);

      // Single dialog with 3 options:
      // Yes = "Save As..." (save current version to new location)
      // No = "Reload" (discard changes and load from disk)
      // Cancel = "Keep my changes" (do nothing, preserve user's work)
      const result = await message(
        i18n.t("dialog:fileChanged.message", { fileName }),
        {
          title: i18n.t("dialog:fileChanged.title"),
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
          title: i18n.t("dialog:saveVersionAs.title"),
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
          fileOpsError("Failed to reload file:", filePath, error);
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
        /* v8 ignore next -- @preserve || "file" fallback fires only when getFileName returns "" (path is "/"); effectively unreachable in production */
        const fileNames = pending.map((p) => getFileName(p.filePath) || "file").join(", ");
        const result = await message(
          i18n.t("dialog:fileChanged.multipleMessage", { count: pending.length, fileNames }),
          {
            title: i18n.t("dialog:fileChanged.multipleTitle"),
            kind: "warning",
            buttons: {
              yes: i18n.t("dialog:fileChanged.buttonReloadAll"),
              no: i18n.t("dialog:fileChanged.buttonKeepAll"),
              cancel: i18n.t("dialog:fileChanged.buttonReviewEach"),
            },
          }
        );

        const batchButtons = {
          reloadAll: i18n.t("dialog:fileChanged.buttonReloadAll"),
          keepAll: i18n.t("dialog:fileChanged.buttonKeepAll"),
          reviewEach: i18n.t("dialog:fileChanged.buttonReviewEach"),
        } as const;

        if (result === "Yes" || result === batchButtons.reloadAll) {
          // Reload all files from disk
          for (const { tabId, filePath } of pending) {
            try {
              await reloadTabFromDisk(tabId, filePath);
            } catch (error) {
              fileOpsError("Failed to reload file:", filePath, error);
              useDocumentStore.getState().markMissing(tabId);
            }
          }
        } else if (result === "No" || result === batchButtons.keepAll) {
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
      // If new items were queued during processing, schedule another round
      if (pendingDirtyChangesRef.current.length > 0) {
        batchTimeoutRef.current = setTimeout(() => {
          batchTimeoutRef.current = null;
          processBatchedChanges();
        }, BATCH_DEBOUNCE_MS);
      }
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

  // Handle a modify-like event by reading disk content and applying policy.
  // Shared by the modify/create branch and the rename fallback (atomic writes).
  const handleModifyEvent = useCallback(
    async (tabId: string, changedPath: string, diskContent: string) => {
      const doc = useDocumentStore.getState().getDocument(tabId);
      /* v8 ignore next -- @preserve doc is always defined when tabId is from an open tab; null branch is defensive */
      if (!doc) return;

      // File reappeared after deletion — always reload and clear missing
      if (doc.isMissing) {
        useDocumentStore.getState().loadContent(tabId, diskContent, changedPath, detectLinebreaks(diskContent));
        useDocumentStore.getState().clearMissing(tabId);
        toast.info(i18n.t("dialog:toast.restored", { filename: getFileName(changedPath) }));
        return;
      }

      // Disk matches what we last wrote — no actual external change
      if (diskContent === doc.lastDiskContent) {
        return;
      }

      // Divergent doc: disk now matches editor — auto-clear divergent state so auto-save resumes.
      // This happens when e.g. git checkout restores the same content that's in the editor.
      if (doc.isDivergent && diskContent === doc.content) {
        useDocumentStore.getState().loadContent(tabId, diskContent, changedPath, detectLinebreaks(diskContent));
        return;
      }

      // Real external change — apply policy
      const action = resolveExternalChangeAction({
        isDirty: doc.isDirty,
        hasFilePath: Boolean(doc.filePath),
      });

      switch (action) {
        case "auto_reload":
          useDocumentStore.getState().loadContent(tabId, diskContent, changedPath, detectLinebreaks(diskContent));
          useDocumentStore.getState().clearMissing(tabId);
          toast.info(i18n.t("dialog:toast.reloaded", { filename: getFileName(changedPath) }));
          break;
        case "prompt_user":
          queueDirtyChange(tabId, changedPath);
          break;
        case "no_op":
          break;
      }
    },
    [queueDirtyChange]
  );

  useEffect(() => {
    let cancelled = false;

    const setupListener = async () => {
      /* v8 ignore next -- @preserve cancelled is only true during React cleanup; race condition branch */
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
              if (!tabId) continue;

              // Skip our own atomic writes (rename is part of temp→target)
              if (hasPendingSave(normalizedPath)) continue;

              // Verify file is actually gone before marking as deleted.
              // Atomic writes trigger rename events but the target still exists.
              try {
                const diskContent = await readTextFile(changedPath);
                // File still exists — treat as modify, run content checks
                await handleModifyEvent(tabId, changedPath, diskContent);
              } catch {
                // File truly deleted
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
            let diskContent: string;
            try {
              diskContent = await readTextFile(changedPath);
            } catch {
              // File unreadable (might be deleted or locked) — skip
              continue;
            }

            // Filter out our own pending saves
            if (matchesPendingSave(changedPath, diskContent)) {
              continue;
            }

            await handleModifyEvent(tabId, changedPath, diskContent);
          }
        }
      });

      if (cancelled) {
        unlisten();
        return;
      }

      unlistenRef.current = unlisten;
    };

    setupListener().catch((error) => {
      fileOpsError("Failed to setup external file change listener:", error);
    });

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
  }, [windowLabel, getOpenFilePaths, queueDirtyChange, handleDeletion, handleModifyEvent]);
}
