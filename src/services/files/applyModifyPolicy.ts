/**
 * What to do when an open file's bytes changed on disk.
 *
 * Purpose: the per-tab REACTION policy for a modify-like event — restore,
 *   no-op, un-diverge, auto-reload, or queue a conflict for the user.
 *
 * Extracted from `useExternalFileChanges`, where it was a 60-line branch inside
 * a hook. Nothing here is React: it is a function of the document's current
 * state and the bytes now on disk, and it is tested as one.
 *
 * Key decisions:
 *   - Disk-vs-store comparison is SOFT (`softContentEquals`), because cloud
 *     sync daemons (OneDrive, iCloud, Dropbox) rewrite files touching only line
 *     endings, the BOM, or the trailing newline. A byte comparison reported
 *     those as external changes and prompted the user for nothing.
 *   - A soft-equal rewrite still refreshes `lastDiskContent`, or the NEXT byte
 *     comparison would fail the same way and the sync would slip through again.
 *   - The `auto_reload` case deliberately does not `clearMissing`: the
 *     `isMissing` branch returns in both its arms and nothing between that read
 *     and the switch awaits, so a missing document cannot reach it. The call
 *     was a no-op that still wrote to the store and woke every subscriber.
 *
 * @coordinates-with hooks/useExternalFileChanges.ts — sole caller
 * @coordinates-with utils/openPolicy — resolveExternalChangeAction
 * @module services/files/applyModifyPolicy
 */
import { useDocumentStore } from "@/stores/documentStore";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { getFileName } from "@/utils/paths";
import { softContentEquals } from "@/utils/linebreaks";
import { resolveExternalChangeAction } from "@/utils/openPolicy";

/** Ask the user about a conflict on this tab (debounced and batched). */
export type QueueDirtyChange = (tabId: string, filePath: string) => void;

/**
 * Apply the reaction policy for a modify-like event.
 *
 * Shared by the modify/create branch and the rename fallback, because a
 * Windows atomic save (MoveFileEx) arrives as a rename whose target is simply
 * the file's new bytes.
 */
export function applyModifyPolicy(
  tabId: string,
  changedPath: string,
  diskContent: string,
  queueDirtyChange: QueueDirtyChange,
): void {
  const doc = useDocumentStore.getState().getDocument(tabId);
  /* v8 ignore next -- @preserve doc is always defined when tabId is from an open tab; null branch is defensive */
  if (!doc) return;

  // File reappeared after deletion — reload unless the user has unsaved edits.
  if (doc.isMissing) {
    if (doc.isDirty) {
      queueDirtyChange(tabId, changedPath);
      return;
    }
    useDocumentStore
      .getState()
      .ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
    useDocumentStore.getState().clearMissing(tabId);
    toast.info(i18n.t("dialog:toast.restored", { filename: getFileName(changedPath) }));
    return;
  }

  // Disk matches what we last wrote — no actual external change. See the header
  // for why this comparison is soft and why it still refreshes the snapshot.
  if (softContentEquals(diskContent, doc.lastDiskContent)) {
    if (diskContent !== doc.lastDiskContent) {
      useDocumentStore.getState().updateLastDiskContent(tabId, diskContent);
    }
    return;
  }

  // Divergent doc: disk now matches the editor — clear the divergent state so
  // auto-save resumes. Happens when e.g. a git checkout restores the same
  // content the editor is already showing.
  if (doc.isDivergent && softContentEquals(diskContent, doc.content)) {
    useDocumentStore
      .getState()
      .ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
    return;
  }

  const action = resolveExternalChangeAction({
    isDirty: doc.isDirty,
    hasFilePath: Boolean(doc.filePath),
  });

  switch (action) {
    case "auto_reload":
      useDocumentStore
        .getState()
        .ingestExternalContent(tabId, diskContent, "disk-open", { filePath: changedPath });
      toast.info(i18n.t("dialog:toast.reloaded", { filename: getFileName(changedPath) }));
      break;
    case "prompt_user":
      queueDirtyChange(tabId, changedPath);
      break;
    case "no_op":
      break;
  }
}
