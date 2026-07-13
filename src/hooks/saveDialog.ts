/**
 * Save-dialog and save-path helpers
 *
 * Purpose: the path/dialog half of the save handlers — native save dialog,
 *   its error/cancel policy, the default filename for a save prompt, and
 *   same-file detection for Move To.
 *
 * @coordinates-with useFileSave.ts — sole consumer (Save / Save As / Move To)
 * @module hooks/saveDialog
 */

import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { save } from "@tauri-apps/plugin-dialog";
import { useTabStore } from "@/stores/tabStore";
import { dispatchEditor, getFormatById } from "@/lib/formats/registry";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { joinPath } from "@/utils/pathUtils";
import { getSaveFileName } from "@/utils/exportNaming";
import { normalizePath } from "@/utils/paths";
import { isMacPlatform, isWindowsPlatform } from "@/utils/platform";
import { fileOpsLog, fileOpsError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/**
 * Open a native save dialog and return the chosen path (or null on cancel).
 *
 * We intentionally skip file-type filters because macOS 26 (Tahoe) deprecated
 * the `setAllowedFileTypes` API used by rfd, causing the dialog to hang or
 * crash. Omitting filters avoids the issue entirely — the default filename
 * already carries the `.md` extension, so users still save as Markdown.
 */
export async function saveDialogWithFallback(
  defaultPath: string,
): Promise<string | null> {
  return save({ defaultPath });
}

/**
 * Prompt for a save path. Returns null when the user cancelled *or* the dialog
 * failed (logged + pinned toast) — every caller aborts the save in both cases.
 */
export async function promptForSavePath(
  defaultPath: string,
  label: string,
): Promise<string | null> {
  try {
    const path = await saveDialogWithFallback(defaultPath);
    fileOpsLog(`${label} dialog returned:`, path ?? "(cancelled)");
    return path;
  } catch (error) {
    fileOpsError(`${label} dialog threw:`, error);
    toast.error(
      i18n.t("dialog:toast.saveDialogFailed", { error: errorMessage(error) }),
      { pin: true },
    );
    return null;
  }
}

/**
 * True when two paths address the same file. String equality is not enough: the
 * dialog can return a separator (Windows) or case variant of the stored path,
 * and on a case-insensitive filesystem (APFS/HFS+ default, NTFS) that variant is
 * the SAME file — writing it and then deleting the "old" path destroys the
 * document. Linux is case-sensitive, so there the variants are distinct files.
 */
export function isSameFilePath(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (left === right) return true;
  if (!isMacPlatform() && !isWindowsPlatform()) return false;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Build default path for save dialog from document content and tab info.
 */
export async function buildDefaultSavePath(
  windowLabel: string,
  tabId: string,
  content: string,
  existingPath: string | null,
): Promise<string> {
  if (existingPath) return existingPath;

  const tab = useTabStore.getState().tabs[windowLabel]?.find(t => t.id === tabId);
  const docTab = tab && tab.kind === "document" ? tab : null; // untitled save is document-only
  const suggestedName = getSaveFileName(content, tab?.title ?? "");
  // WI-1B.9 — default extension = active format's untitledExtension (untitled → markdown → ".md").
  let ext = "md";
  try {
    const cfg = docTab?.formatId
      ? (getFormatById(docTab.formatId) ?? dispatchEditor(docTab.filePath ?? null))
      : dispatchEditor(docTab?.filePath ?? null);
    ext = cfg.adapters.untitledExtension;
  } catch {
    /* registry not bootstrapped — keep .md default */
  }
  const filename = `${suggestedName}.${ext}`;
  const folder = await getDefaultSaveFolderWithFallback(windowLabel);
  return joinPath(folder, filename);
}
