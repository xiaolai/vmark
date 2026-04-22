/**
 * Large File Pre-Open Prompts
 *
 * Purpose: Two native dialogs used by the open flow before a large file is
 * read from disk — a warning confirmation for the "huge" tier (≥ 5 MB) and
 * a non-negotiable refusal for the "refused" tier (≥ 50 MB). Both run in
 * front of `readTextFile`, so the "no modal during load" contract from the
 * large-file plan is preserved — nothing is loading yet at prompt time.
 *
 * Implementation notes:
 *   - Uses Tauri's dialog plugin (`ask` / `message`) for consistency with the
 *     unsaved-changes flow in `closeSave.ts`. Native dialogs are already
 *     permitted via `dialog:default` + `dialog:allow-open` capabilities.
 *   - Keeps filename-in-title short via `basename()`; the full path is noisy
 *     for long workspace paths.
 *   - Translation keys live in `src/locales/**\/dialog.json` under
 *     `largeFile.warn*` / `largeFile.refuse*`.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — calls confirmOpenHugeFile before readTextFile.
 * @coordinates-with hooks/useFileOpen.ts — same; routes all open paths through tier checks.
 * @coordinates-with utils/fileSizeThresholds.ts — provides the byte→tier classification.
 * @module utils/largeFilePrompts
 */

import { ask, message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { formatFileSize, FILE_SIZE_THRESHOLDS } from "@/utils/fileSizeThresholds";

/** Extract the trailing filename from a POSIX or Windows path. */
function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Show a pre-open confirmation for files in the "huge" tier (≥ 5 MB, < 50 MB).
 *
 * Returns `true` when the user opts to open (Source mode), `false` for cancel.
 * Escape / window dismiss both resolve to `false` so the default is safe.
 */
export async function confirmOpenHugeFile(path: string, sizeBytes: number): Promise<boolean> {
  const filename = basename(path);
  const size = formatFileSize(sizeBytes);

  return await ask(
    i18n.t("dialog:largeFile.warnBody", { size }),
    {
      title: i18n.t("dialog:largeFile.warnTitle", { filename }),
      kind: "warning",
      okLabel: i18n.t("dialog:largeFile.warnOk"),
      cancelLabel: i18n.t("dialog:largeFile.warnCancel"),
    }
  );
}

/**
 * Show the immovable refusal for files ≥ 50 MB. The caller must abort the open
 * regardless of return value (the dialog has one button); we still return a
 * Promise<void> so callers can `await` before re-enabling UI affordances.
 */
export async function showHugeFileRefusal(path: string, sizeBytes: number): Promise<void> {
  const filename = basename(path);
  const size = formatFileSize(sizeBytes);
  const limit = formatFileSize(FILE_SIZE_THRESHOLDS.HARD_REFUSE_BYTES);

  await message(
    i18n.t("dialog:largeFile.refuseBody", { filename, size, limit }),
    {
      title: i18n.t("dialog:largeFile.refuseTitle"),
      kind: "error",
    }
  );
}
