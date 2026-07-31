/**
 * Sibling Reference Collection
 *
 * Purpose: gather every image reference held by the OTHER documents sharing an
 * assets folder — from their live buffers when the caller supplies them,
 * unioned with their on-disk content otherwise. Split out of
 * orphanAssetCleanup.ts along this seam when it crossed the size limit; the
 * public scan/delete API stays there.
 *
 * @coordinates-with orphanAssetCleanup.ts — sole consumer
 * @module services/media/siblingReferences
 */

import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { isMarkdownFileName } from "@/utils/dropPaths";
import { extractImageReferenceKeys } from "@/utils/imageReferences";
import { canonicalPathKey } from "@/utils/paths/pathComparison";
import { orphanCleanupError } from "@/utils/debug";

/** How many sibling documents to read at once. Unbounded `Promise.all` over a
 *  large notes folder exhausts file descriptors and stalls window close. */
const SIBLING_READ_CONCURRENCY = 8;

/** True when `filePath` sits directly in `dir` (not in a subdirectory). */
function isSameDirectory(filePath: string, dir: string): boolean {
  const cut = filePath.lastIndexOf("/");
  return cut !== -1 && filePath.slice(0, cut) === dir;
}

/** Run `worker` over `items` at most `limit` at a time, in order-independent batches. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface SiblingScan {
  /** Reference keys held by the other documents sharing this assets folder. */
  keys: Set<string>;
  /** False if any sibling (or the directory listing) could not be read. */
  complete: boolean;
}

/**
 * Collect every image reference held by the OTHER documents in `docDir`, which
 * share this assets folder.
 */
export async function collectSiblingReferences(
  docDir: string,
  documentPath: string,
  knownContents: ReadonlyMap<string, string>
): Promise<SiblingScan> {
  let entries;
  try {
    entries = await readDir(docDir);
  } catch (error) {
    orphanCleanupError(" Failed to list sibling documents:", error);
    return { keys: new Set(), complete: false };
  }

  const siblings = entries.filter((entry) => entry.isFile && isMarkdownFileName(entry.name));
  const onDisk = await Promise.all(siblings.map((entry) => join(docDir, entry.name)));

  // An open document that readDir did NOT return still holds references — it may
  // have been deleted or moved externally while its buffer stays on screen.
  // Missing it deletes an image that document still displays.
  const onDiskKeys = new Set(onDisk.map(canonicalPathKey));
  const buffered = [...knownContents.keys()].filter(
    (path) =>
      canonicalPathKey(path) !== canonicalPathKey(documentPath) &&
      !onDiskKeys.has(canonicalPathKey(path)) &&
      isSameDirectory(canonicalPathKey(path), canonicalPathKey(docDir))
  );

  const keys = new Set<string>();
  let complete = true;
  const add = (content: string) =>
    extractImageReferenceKeys(content).forEach((key) => keys.add(key));

  const subjectKey = canonicalPathKey(documentPath);
  await mapWithConcurrency([...onDisk, ...buffered], SIBLING_READ_CONCURRENCY, async (fullPath) => {
    // The subject document's authoritative content is the caller's argument;
    // the on-disk copy may be stale (unsaved edits) and would resurrect the
    // very images the user just removed. Compared canonically (WI-8c).
    if (canonicalPathKey(fullPath) === subjectKey) return;

    const known = knownContents.get(canonicalPathKey(fullPath));
    if (known !== undefined) add(known);

    // Read the file EVEN WHEN a buffer exists, and union both. The buffer can be
    // behind the file (a sync client or another editor just rewrote it), and
    // trusting only one side deletes what the other still references. A missing
    // file is fine when a buffer covered it; otherwise the scan is incomplete.
    try {
      add(await readTextFile(fullPath));
    } catch (error) {
      if (known === undefined) {
        orphanCleanupError(` Failed to read sibling ${fullPath}:`, error);
        complete = false;
      }
    }
  });

  return { keys, complete };
}
