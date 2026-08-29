/**
 * Disk actions for the tab context menu (WI-DSPL1.5 extraction).
 *
 * Pulled out of `useTabContextMenuActions` to make room for "Open to the Side"
 * — that file sat exactly on its 300-line-limit baseline. Both are genuinely
 * services rather than callbacks: each talks to disk and owns its own user
 * feedback. The caller keeps ownership of dismissing the menu.
 *
 * @coordinates-with components/Tabs/useTabContextMenuActions.ts — the caller
 * @module services/tabs/tabDiskActions
 */
import i18n from "@/i18n";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useDocumentStore, type DocumentState } from "@/stores/documentStore";
import { saveToPath } from "@/services/persistence/saveToPath";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { confirmAction } from "@/services/dialogs/confirmAction";

/** Write an in-memory document back over a file that vanished from disk. */
export async function restoreTabToDisk(
  tabId: string,
  filePath: string | null,
  doc: DocumentState | undefined,
): Promise<void> {
  /* v8 ignore next -- @preserve defensive guard; the item only appears when both are present */
  if (!filePath || !doc) return;
  const saved = await saveToPath(tabId, filePath, doc.content, "manual");
  if (!saved) {
    // Deliberately silent. `saveToPath` owns failure feedback for a MANUAL save
    // and has already shown the specific reason — the vanished parent directory
    // with its path, an ownership conflict, or the system error text. A second
    // generic "failed to restore" toast stacked on top of that and carried
    // strictly LESS information than the one already on screen.
    return;
  }
  useDocumentStore.getState().clearMissing(tabId);
  toast.success(i18n.t("dialog:toast.fileRestoredToDisk"));
}

/** Discard local edits and reload the file, after confirming. */
export async function revertTabToSaved(
  tabId: string,
  title: string,
  filePath: string | null,
  doc: DocumentState | undefined,
): Promise<void> {
  /* v8 ignore next -- @preserve defensive guard; the item only appears when both are present */
  if (!filePath || !doc) return;
  const confirmed = await confirmAction({
    title: i18n.t("dialog:revertToSaved.title"),
    message: i18n.t("dialog:revertToSaved.message", { title }),
    actionLabel: i18n.t("dialog:action.revert"),
    kind: "warning",
  });
  if (!confirmed) return;
  try {
    await reloadTabFromDisk(tabId, filePath);
    toast.success(i18n.t("dialog:toast.revertedToSaved"));
  } catch {
    toast.error(i18n.t("dialog:toast.failedToRevert"));
  }
}
