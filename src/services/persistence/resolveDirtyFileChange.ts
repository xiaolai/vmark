/**
 * Purpose: resolve ONE externally-changed file that has unsaved edits — the
 * three-option dialog (Save As / Reload / Keep) and everything each choice
 * implies.
 *
 * Extracted from `useExternalFileChanges`, where it was a 90-line callback
 * inside a 391-line hook and could only be reached through a React lifecycle,
 * a filesystem watcher and a native dialog.
 *
 * Key decisions:
 *   - The document is re-read AFTER every await, never captured before one.
 *     This dialog stays open as long as the user leaves it open, and a Save As
 *     dialog follows it; the old code captured `doc` before both and wrote
 *     `doc.content` afterwards, so anything typed in between was silently
 *     dropped from the saved copy. Re-reading is also how a tab closed
 *     mid-dialog stops being written to.
 *   - Save dialog filters come from the format registry via
 *     `resolveSaveFilters`, so the filter name is localized. The old inline
 *     fallback shipped a hardcoded English "Markdown".
 *   - Cancel is the safe default: keep local edits, mark divergent, and adopt
 *     current disk bytes as `lastDiskContent` so an identical follow-up cloud
 *     rewrite is swallowed by the soft-equals guard instead of re-prompting
 *     (issue 904).
 *
 * @coordinates-with hooks/useExternalFileChanges.ts — the only production caller
 * @coordinates-with services/persistence/reloadFromDisk.ts — the Reload branch
 * @module services/persistence/resolveDirtyFileChange
 */
import { readTextFile } from "@tauri-apps/plugin-fs";
import { message, save } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { dispatchEditor } from "@/lib/formats/registry";
import { resolveSaveFilters, markdownSaveFilters } from "@/lib/formats/saveFilters";
import { saveToPath } from "@/services/persistence/saveToPath";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { getFileName } from "@/utils/paths";
import { fileOpsError } from "@/utils/debug";

/** Save-dialog filters for `filePath`, localized, with a markdown fallback. */
function saveFiltersFor(filePath: string): { name: string; extensions: string[] }[] {
  try {
    return resolveSaveFilters(dispatchEditor(filePath));
  } catch {
    /* registry not bootstrapped — one shared, localized markdown fallback */
    return markdownSaveFilters();
  }
}

/** Keep local edits: mark divergent and adopt disk bytes as the new baseline. */
async function keepLocalChanges(tabId: string, filePath: string): Promise<void> {
  useDocumentStore.getState().markDivergent(tabId);

  // Best-effort: a read failure leaves lastDiskContent stale, whose worst case
  // is the prompt re-appearing — strictly better than failing the resolution.
  try {
    const currentDisk = await readTextFile(filePath);
    // Re-check: the tab can close while the read is in flight.
    if (!useDocumentStore.getState().getDocument(tabId)) return;
    useDocumentStore.getState().updateLastDiskContent(tabId, currentDisk);
  } catch (error) {
    fileOpsError(
      "Failed to refresh lastDiskContent after Keep my changes:",
      filePath,
      error
    );
  }
}

/** Save the current editor content to a new location. */
async function saveToNewLocation(tabId: string, filePath: string): Promise<void> {
  const savePath = await save({
    title: i18n.t("dialog:saveVersionAs.title"),
    defaultPath: filePath,
    filters: saveFiltersFor(filePath),
  });
  if (!savePath) return; // cancelled — keep the user's changes, do not reload

  // Re-read AFTER both dialogs. Capturing content before them wrote whatever
  // the buffer held when the file changed, discarding every edit made while
  // the user was deciding.
  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) return; // tab closed mid-dialog

  const saved = await saveToPath(tabId, savePath, doc.content, "manual");
  if (saved) useDocumentStore.getState().clearMissing(tabId);
}

/** Discard local edits and take what is on disk. */
async function reloadFromDisk(tabId: string, filePath: string): Promise<void> {
  try {
    await reloadTabFromDisk(tabId, filePath);
  } catch (error) {
    fileOpsError("Failed to reload file:", filePath, error);
    useDocumentStore.getState().markMissing(tabId);
  }
}

/**
 * Ask the user how to resolve an externally-changed file with unsaved edits.
 *
 * Yes = Save As, No = Reload (discards local edits), Cancel/dismiss = Keep.
 */
export async function resolveDirtyFileChange(
  tabId: string,
  filePath: string
): Promise<void> {
  const buttons = {
    saveAs: i18n.t("dialog:fileChanged.buttonSaveAs"),
    reload: i18n.t("dialog:fileChanged.buttonReload"),
    keep: i18n.t("dialog:fileChanged.buttonKeep"),
  } as const;

  const fileName = getFileName(filePath) || i18n.t("dialog:fileChanged.unknownFile");

  // With custom buttons plugin-dialog returns the clicked LABEL; with default
  // buttons it returns 'Yes' | 'No' | 'Cancel'. Both spellings are accepted.
  const result = await message(i18n.t("dialog:fileChanged.message", { fileName }), {
    title: i18n.t("dialog:fileChanged.title"),
    kind: "warning",
    buttons: { yes: buttons.saveAs, no: buttons.reload, cancel: buttons.keep },
  });

  if (result === "Yes" || result === buttons.saveAs) {
    await saveToNewLocation(tabId, filePath);
    return;
  }
  if (result === "No" || result === buttons.reload) {
    await reloadFromDisk(tabId, filePath);
    return;
  }
  await keepLocalChanges(tabId, filePath);
}
