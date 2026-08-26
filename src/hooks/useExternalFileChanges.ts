/**
 * External File Changes Hook
 *
 * Purpose: Detects and responds to filesystem changes on open documents —
 *   auto-reloads clean docs, prompts for dirty docs, marks deleted files.
 *   Owns the per-tab REACTION POLICY only; the batching state machine and the
 *   single-file resolution dialog are separate, directly testable modules.
 *
 * Key decisions:
 *   - Clean docs auto-reload silently; dirty docs batch into one dialog
 *   - matchesPendingSave() filters out our own saves echoing back
 *   - Rename/`remove` verify existence before marking deleted — Windows atomic
 *     saves (MoveFileEx) and sync daemons fire spurious events for files that
 *     still exist (issue 995); handleModifyEvent() is shared by both paths
 *   - Media tabs (png/mp4/…) are never UTF-8-read: remove/rename existence-probe
 *     only. A media create/modify bumps `documentId` (and a `create` also clears
 *     isMissing) so MediaView re-fetches — the asset URL alone cannot do it,
 *     because an element whose `src` never changes never reloads (issue #1328)
 *   - Deleted files get isMissing (no auto-close — user may want to save)
 *   - Divergent docs auto-recover when disk content matches editor content
 *   - After "Keep my changes", lastDiskContent is refreshed to current disk so
 *     identical follow-up cloud-sync rewrites (OneDrive/iCloud/Dropbox) are
 *     silently no-op'd by the soft-equals guard, not re-prompted (issue 904)
 *   - A rejected batch is NOT lost. The queue puts it back, so a dialog that
 *     fails still leaves the conflicts pending rather than silently resolving
 *     them in the filesystem's favour
 *
 * @coordinates-with useWindowFileWatcher.ts — starts/stops the Rust watcher
 * @coordinates-with useWorkspaceEventBus.ts — subscribes to the shared normalized fs-event source
 * @coordinates-with services/windowClose/fsChangeHandlers.ts — handleSemanticBatch routes each batch to the per-kind handlers
 * @coordinates-with documentStore.ts — reads dirty state, updates content on reload
 * @coordinates-with services/files/resolveDirtyBatch.ts — revalidates a batch, then runs the one-file or bulk dialog
 * @coordinates-with externalChangeBatchQueue.ts — the debounce/requeue/single-timer rules
 * @coordinates-with services/persistence/resolveDirtyFileChange.ts — the 3-option dialog
 * @module hooks/useExternalFileChanges
 */
import { useEffect, useRef, useCallback } from "react";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { applyExternalRename } from "@/services/workspaces/reassignTabOwnershipForPath";
import { isBinaryMediaPath } from "@/services/navigation/openMediaFile";
import { normalizePath } from "@/utils/paths";
import { matchesPendingSave, hasPendingSave } from "@/utils/pendingSaves";
import { fileOpsError } from "@/utils/debug";
import { subscribeWorkspaceEvents } from "@/services/workspaceEvents/subscribeWorkspaceEvents";
import { createBatchQueue, type BatchQueue } from "@/services/files/externalChangeBatchQueue";
import {
  resolveDirtyBatch,
  type PendingDirtyChange,
} from "@/services/files/resolveDirtyBatch";
import { applyModifyPolicy } from "@/services/files/applyModifyPolicy";
import { handleSemanticBatch, type FsChangeContext } from "@/services/windowClose/fsChangeHandlers";

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

  // Serializes fs-event batches. See the subscription below for why parallel
  // batches let an older disk read overwrite a newer one.
  const batchChainRef = useRef<Promise<void>>(Promise.resolve());

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

  // Re-point a renamed tab + document; ownership follows the path (WI-13.4).
  const applyRename = useCallback(
    (tabId: string, newPath: string) => applyExternalRename(windowLabel, tabId, newPath),
    [windowLabel],
  );

  // One queue per hook instance. A rejected batch is put BACK by the queue —
  // the old inline version drained it before awaiting the dialog, so a
  // rejection lost the conflicts.
  if (queueRef.current === null) {
    queueRef.current = createBatchQueue<PendingDirtyChange>({
      debounceMs: BATCH_DEBOUNCE_MS,
      process: resolveDirtyBatch,
      onError: (error) => fileOpsError("Failed to process batched file changes:", error),
    });
  }

  // Queue a dirty file change for batched processing. Keyed by normalized path
  // so duplicate fs events for one file don't prompt or reload it twice.
  const queueDirtyChange = useCallback((tabId: string, filePath: string) => {
    queueRef.current?.queue(normalizePath(filePath), { tabId, filePath });
  }, []);

  // The reaction policy itself lives in `applyModifyPolicy` — it is a function
  // of the document's state and the bytes on disk, with no React in it. Shared
  // by the modify/create branch and the rename fallback (atomic writes).
  const handleModifyEvent = useCallback(
    async (tabId: string, changedPath: string, diskContent: string) =>
      applyModifyPolicy(tabId, changedPath, diskContent, queueDirtyChange),
    [queueDirtyChange],
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
      markBinaryFileChanged: (tabId) =>
        useDocumentStore.getState().markBinaryFileChanged(tabId),
    };

    // SERIALIZED, not fired in parallel. Each delivery used to spawn an
    // unawaited batch, so two changes arriving close together ran their disk
    // reads concurrently — and reads do not finish in the order they start (a
    // larger file, a cold cache, a network volume). The EARLIER batch could
    // therefore land last and write content the user had already superseded,
    // which presents as a document silently reverting to a version that was on
    // disk moments ago.
    //
    // Chaining preserves arrival order, which is the property that matters: the
    // watcher delivers events in the order the filesystem produced them, and
    // the last write must be the newest one. A batch is short — reads plus
    // policy — because the dirty-file dialog is not inside it; that goes
    // through the debounced queue, so serializing cannot park behind a modal.
    //
    // The chain must never reject, or every later batch would be skipped: each
    // link swallows its own error into the log, exactly as the old `.catch`
    // did per batch.
    const unsubscribe = subscribeWorkspaceEvents(windowLabel, (events) => {
      batchChainRef.current = batchChainRef.current.then(() =>
        handleSemanticBatch(ctx, events, getOpenFilePaths).catch((error) => {
          fileOpsError("Failed to handle external file changes:", error);
        }),
      );
    });

    return () => {
      unsubscribe();
      // DISPOSE, not cancel. Cancelling clears the timer but cannot reach a
      // batch already in flight, and that batch re-schedules from its own
      // `finally` — so a resolution dialog open at unmount re-armed a timer
      // after cleanup had cancelled one, and it fired into a torn-down hook.
      // `dispose()` latches, so a late completion finds the queue closed.
      queueRef.current?.dispose();
      queueRef.current = null;
    };
  }, [windowLabel, getOpenFilePaths, handleDeletion, handleModifyEvent, applyRename]);
}
