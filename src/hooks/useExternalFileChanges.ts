/**
 * External File Changes Hook
 *
 * Purpose: Detects and responds to filesystem changes on open documents —
 *   auto-reloads clean docs, prompts for dirty docs, marks deleted files.
 *
 * Key decisions:
 *   - Clean docs auto-reload silently; dirty docs batch into one dialog
 *   - matchesPendingSave() filters out our own saves echoing back
 *   - Rename/`remove` verify existence before marking deleted — Windows atomic
 *     saves (MoveFileEx) and sync daemons fire spurious events for files that
 *     still exist (issue 995); handleModifyEvent() is shared by both paths
 *   - Media tabs (png/mp4/…) are never UTF-8-read: remove/rename existence-probe
 *     only, and a media `create` clears isMissing so MediaView re-streams
 *   - Deleted files get isMissing (no auto-close — user may want to save)
 *   - Divergent docs auto-recover when disk content matches editor content
 *   - After "Keep my changes", lastDiskContent is refreshed to current disk so
 *     identical follow-up cloud-sync rewrites (OneDrive/iCloud/Dropbox) are
 *     silently no-op'd by the soft-equals guard, not re-prompted (issue 904)
 *
 * @coordinates-with useWindowFileWatcher.ts — starts/stops the Rust watcher
 * @coordinates-with useWorkspaceEventBus.ts — subscribes to the shared normalized fs-event source
 * @coordinates-with fsChangeHandlers.ts — handleSemanticBatch routes each batch to the per-kind handlers
 * @coordinates-with documentStore.ts — reads dirty state, updates content on reload
 * @coordinates-with fileChangeBatch.ts — the reload-all/keep-all/review-each resolutions
 * @module hooks/useExternalFileChanges
 */
import { useEffect, useRef, useCallback } from "react";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { message } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { isBinaryMediaPath } from "@/services/navigation/openMediaFile";
import {
  reloadAllFromDisk,
  keepAllLocal,
  reviewEachIndividually,
} from "@/hooks/fileChangeBatch";
import { resolveExternalChangeAction } from "@/utils/openPolicy";
import { normalizePath } from "@/utils/paths";
import { softContentEquals } from "@/utils/linebreaks";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { matchesPendingSave, hasPendingSave } from "@/utils/pendingSaves";
import { getFileName } from "@/utils/paths";
import { fileOpsError } from "@/utils/debug";
import { subscribeWorkspaceEvents } from "@/hooks/useWorkspaceEventBus";
import { resolveDirtyFileChange } from "@/services/persistence/resolveDirtyFileChange";
import { createBatchQueue, type BatchQueue } from "./externalChangeBatchQueue";
import { handleSemanticBatch, type FsChangeContext } from "./fsChangeHandlers";

/** Pending dirty file change awaiting user decision */
interface PendingDirtyChange {
  tabId: string;
  filePath: string;
}

/** Debounce window for batching external changes (ms) */
const BATCH_DEBOUNCE_MS = 300;

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

  // Batching state for dirty file changes. Keyed by normalized file path so
  // duplicate fs events for the same file collapse into a single pending entry.
  // The timer/re-entrancy/requeue rules live in `createBatchQueue`, which is
  // testable without React — see externalChangeBatchQueue.ts for the two
  // defects that were unreachable while this was inline.
  const queueRef = useRef<BatchQueue<PendingDirtyChange> | null>(null);

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

  const handleDeletion = useCallback((targetTabId: string) => {
    useDocumentStore.getState().markMissing(targetTabId);
  }, []);

  // Re-point a renamed tab + its document at the new path (clears missing).
  const applyRename = useCallback((tabId: string, newPath: string) => {
    useTabStore.getState().updateTabPath(tabId, newPath);
    useDocumentStore.getState().setFilePath(tabId, newPath);
    useDocumentStore.getState().clearMissing(tabId);
  }, []);

  // Resolve one batch: one file goes straight to the single-file dialog,
  // several go through the reload-all/keep-all/review-each dialog.
  const processBatch = useCallback(async (pending: PendingDirtyChange[]) => {
    if (pending.length === 1) {
      await resolveDirtyFileChange(pending[0].tabId, pending[0].filePath);
      return;
    }

    /* v8 ignore next -- @preserve unknownFile fallback fires only when getFileName returns "" (path is "/"); effectively unreachable in production */
    const fileNames = pending
      .map((p) => getFileName(p.filePath) || i18n.t("dialog:fileChanged.unknownFile"))
      .join(", ");
    const buttons = {
      reloadAll: i18n.t("dialog:fileChanged.buttonReloadAll"),
      keepAll: i18n.t("dialog:fileChanged.buttonKeepAll"),
      reviewEach: i18n.t("dialog:fileChanged.buttonReviewEach"),
    } as const;

    const result = await message(
      i18n.t("dialog:fileChanged.multipleMessage", { count: pending.length, fileNames }),
      {
        title: i18n.t("dialog:fileChanged.multipleTitle"),
        kind: "warning",
        buttons: { yes: buttons.reloadAll, no: buttons.keepAll, cancel: buttons.reviewEach },
      }
    );

    if (result === "Yes" || result === buttons.reloadAll) {
      await reloadAllFromDisk(pending, reloadTabFromDisk);
    } else if (result === "No" || result === buttons.keepAll) {
      await keepAllLocal(pending);
    } else {
      await reviewEachIndividually(pending, resolveDirtyFileChange);
    }
  }, []);

  // One queue per hook instance, created lazily so `processBatch` is captured
  // once. A rejected batch is put BACK by the queue — the old inline version
  // drained it before awaiting the dialog, so a rejection lost the conflicts.
  if (queueRef.current === null) {
    queueRef.current = createBatchQueue<PendingDirtyChange>({
      debounceMs: BATCH_DEBOUNCE_MS,
      process: processBatch,
      onError: (error) => fileOpsError("Failed to process batched file changes:", error),
    });
  }

  // Queue a dirty file change for batched processing. Keyed by normalized path
  // so duplicate fs events for one file don't prompt or reload it twice.
  const queueDirtyChange = useCallback((tabId: string, filePath: string) => {
    queueRef.current?.queue(normalizePath(filePath), { tabId, filePath });
  }, []);

  // Handle a modify-like event by reading disk content and applying policy.
  // Shared by the modify/create branch and the rename fallback (atomic writes).
  const handleModifyEvent = useCallback(
    async (tabId: string, changedPath: string, diskContent: string) => {
      const doc = useDocumentStore.getState().getDocument(tabId);
      /* v8 ignore next -- @preserve doc is always defined when tabId is from an open tab; null branch is defensive */
      if (!doc) return;

      // File reappeared after deletion — reload unless the user has unsaved edits
      if (doc.isMissing) {
        if (doc.isDirty) {
          queueDirtyChange(tabId, changedPath);
          return;
        }
        useDocumentStore.getState().ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
        useDocumentStore.getState().clearMissing(tabId);
        toast.info(i18n.t("dialog:toast.restored", { filename: getFileName(changedPath) }));
        return;
      }

      // Disk matches what we last wrote — no actual external change.
      // Use soft equality so cloud sync rewrites that only touch line endings,
      // BOM, or the trailing newline (OneDrive/iCloud/Dropbox are frequent
      // offenders) don't trigger spurious reloads or dialogs.
      if (softContentEquals(diskContent, doc.lastDiskContent)) {
        // Refresh the stored disk content so subsequent byte-for-byte compares
        // match; otherwise the next sync rewrite would slip through again.
        if (diskContent !== doc.lastDiskContent) {
          useDocumentStore.getState().updateLastDiskContent(tabId, diskContent);
        }
        return;
      }

      // Divergent doc: disk now matches editor — auto-clear divergent state so auto-save resumes.
      // This happens when e.g. git checkout restores the same content that's in the editor.
      if (doc.isDivergent && softContentEquals(diskContent, doc.content)) {
        useDocumentStore.getState().ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
        return;
      }

      // Real external change — apply policy
      const action = resolveExternalChangeAction({
        isDirty: doc.isDirty,
        hasFilePath: Boolean(doc.filePath),
      });

      switch (action) {
        case "auto_reload":
          useDocumentStore.getState().ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
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
    // The shared workspace event source already scoped these events to the
    // watch root, flagged self-writes, coalesced, and suppressed content
    // no-ops. This hook owns only the per-tab reaction policy. The routing
    // context's collaborators are stable useCallbacks + store reads.
    const ctx: FsChangeContext = {
      readTextFile,
      fileExists: exists,
      normalizePath,
      hasPendingSave,
      matchesPendingSave,
      // Gate on the path's extension, not the tab's formatId — a .png→txt
      // association can't make a binary file safe to read as text.
      isMedia: (path) => isBinaryMediaPath(path),
      applyRename,
      handleModifyEvent,
      handleDeletion,
      isMissing: (tabId) => useDocumentStore.getState().getDocument(tabId)?.isMissing ?? false,
      clearMissing: (tabId) => useDocumentStore.getState().clearMissing(tabId),
    };

    const unsubscribe = subscribeWorkspaceEvents(windowLabel, (events) => {
      void handleSemanticBatch(ctx, events, getOpenFilePaths).catch((error) => {
        fileOpsError("Failed to handle external file changes:", error);
      });
    });

    return () => {
      unsubscribe();
      // One cancel is enough: the queue guarantees a single live timer, which
      // the two-path inline version did not.
      queueRef.current?.cancel();
    };
  }, [windowLabel, getOpenFilePaths, handleDeletion, handleModifyEvent, applyRename]);
}
