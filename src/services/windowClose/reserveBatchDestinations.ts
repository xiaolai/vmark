/**
 * Collision-free destination reservation for a batch of untitled documents.
 *
 * Purpose: Save All over several untitled tabs picks ONE folder, then has to
 * turn each tab's title into a real path in that folder. Doing that with
 * `joinPath(folder, title)` and the ordinary overwrite writer silently replaced
 * whatever was already sitting at that name — a document the user need not
 * even have open (audit 20260906, F1).
 *
 * Two distinct collisions have to be handled, and a within-batch-only fix
 * misses the one that costs bytes:
 *
 *   1. Against FILES ALREADY ON DISK. `Untitled-1.md` is a name VMark itself
 *      hands out, so a folder that has received one before very likely holds
 *      one now.
 *   2. Against OTHER DOCS IN THE SAME BATCH. Two recovered or transferred tabs
 *      can carry the same title, and `toSafeFilename` can collapse two
 *      distinct titles onto one name. The untitled counter is unique only
 *      within one fresh webview.
 *
 * Both are resolved by claiming each destination with `create_file_exclusive`
 * — one kernel-serialized `O_EXCL` create — rather than testing for existence
 * and then writing. A check-then-write still loses to a concurrent second
 * window, and this is the batch that runs while the app is quitting.
 *
 * @coordinates-with closeSaveBatch.ts — the only caller
 * @coordinates-with src-tauri/src/file_write.rs — create_file_exclusive
 * @module services/windowClose/reserveBatchDestinations
 */

import { invoke } from "@tauri-apps/api/core";
import { joinPath } from "@/utils/pathUtils";

/**
 * How many suffixed candidates to try before giving up on a name. Reaching
 * this means ~200 files already share one base name; failing loudly beats
 * looping while the app is trying to quit.
 */
const MAX_CANDIDATES = 200;

/** A base filename split around its extension, so suffixes land before the dot. */
function splitExtension(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  // A leading dot is part of the name (`.gitignore`), not an extension.
  if (dot <= 0) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext: filename.slice(dot) };
}

/**
 * The nth candidate for a base name. `n === 0` is the name itself; after that
 * the platform-conventional " 2", " 3" suffix lands before the extension.
 */
export function candidateName(filename: string, n: number): string {
  if (n === 0) return filename;
  const { stem, ext } = splitExtension(filename);
  return `${stem} ${n + 1}${ext}`;
}

/**
 * Claim one collision-free path per filename inside `folderPath`, in order.
 *
 * Every returned path is an empty file this batch now owns, so the caller may
 * write it through the ordinary overwrite save path. Throws if a name cannot
 * be claimed within {@link MAX_CANDIDATES} attempts, or if the backend reports
 * a real I/O failure (a missing folder, a permission denial) — a reservation
 * that cannot be made must not fall through to an overwrite.
 */
export async function reserveBatchDestinations(
  folderPath: string,
  filenames: string[],
): Promise<string[]> {
  const reserved: string[] = [];

  for (const filename of filenames) {
    let claimed: string | null = null;

    for (let n = 0; n < MAX_CANDIDATES; n++) {
      const candidate = joinPath(folderPath, candidateName(filename, n));
      // Reserving as we go is what makes the batch self-consistent: an earlier
      // doc's claim is already on disk, so a later doc with the same title
      // sees it taken and moves on.
      const created = await invoke<boolean>("create_file_exclusive", {
        path: candidate,
      });
      if (created) {
        claimed = candidate;
        break;
      }
    }

    if (!claimed) {
      throw new Error(
        `Could not reserve a free filename for "${filename}" in ${folderPath} ` +
          `after ${MAX_CANDIDATES} attempts`,
      );
    }
    reserved.push(claimed);
  }

  return reserved;
}
