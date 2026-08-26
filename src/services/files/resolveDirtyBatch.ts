/**
 * Dirty-Batch Resolution
 *
 * Purpose: Decide what happens to a debounced batch of externally-changed
 *   DIRTY documents — revalidate each entry, then run the one-file dialog or
 *   the reload-all/keep-all/review-each dialog.
 *
 * Key decisions:
 *   - Entries are revalidated against the CURRENT store before resolving. An
 *     entry names the tab and path captured when it was queued, and it then
 *     waits out a debounce and — for a multi-file batch — a modal the user may
 *     sit on indefinitely. The rename case is the dangerous one: reloading a
 *     path this document no longer has pulls a DIFFERENT file's bytes into the
 *     buffer.
 *   - Lives outside the hook because none of it is React: it is a function of
 *     the queued entries plus store state, and it is tested as one.
 *
 * @coordinates-with hooks/useExternalFileChanges.ts — supplies the queued batch
 * @coordinates-with services/files/fileChangeBatch.ts — the three bulk resolutions
 * @coordinates-with services/persistence/resolveDirtyFileChange.ts — the single-file dialog
 * @module services/files/resolveDirtyBatch
 */
import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import {
  reloadAllFromDisk,
  keepAllLocal,
  reviewEachIndividually,
} from "@/services/files/fileChangeBatch";
import { isQueuedConflictStillLive } from "@/utils/openPolicy";
import { getFileName, normalizePath } from "@/utils/paths";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { resolveDirtyFileChange } from "@/services/persistence/resolveDirtyFileChange";

/** Pending dirty file change awaiting user decision */
export interface PendingDirtyChange {
  tabId: string;
  filePath: string;
}

/** Drop entries whose tab has since been closed, saved, or renamed away. */
function stillLiveConflicts(queued: PendingDirtyChange[]): PendingDirtyChange[] {
  return queued.filter((entry) =>
    isQueuedConflictStillLive({
      document: useDocumentStore.getState().getDocument(entry.tabId),
      queuedPath: entry.filePath,
      normalize: normalizePath,
    }),
  );
}

/**
 * Resolve one batch: one file goes straight to the single-file dialog, several
 * go through the reload-all/keep-all/review-each dialog.
 */
export async function resolveDirtyBatch(queued: PendingDirtyChange[]): Promise<void> {
  const pending = stillLiveConflicts(queued);
  if (pending.length === 0) return;
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
    },
  );

  if (result === "Yes" || result === buttons.reloadAll) {
    await reloadAllFromDisk(pending, reloadTabFromDisk);
  } else if (result === "No" || result === buttons.keepAll) {
    await keepAllLocal(pending);
  } else {
    await reviewEachIndividually(pending, resolveDirtyFileChange);
  }
}
