/**
 * Orphan Asset Cleanup
 *
 * Purpose: Finds and removes images in the assets folder that no document
 * references. Prevents asset folder bloat from deleted images. This module is
 * the scan-and-delete half; the confirmation flow for the manual command lives
 * in orphanCleanupPrompt.ts, and reference parsing in utils/imageReferences.ts.
 *
 * Key decisions:
 *   - Callers pass the content that will BE on disk after the close; this module
 *     never reads the subject document itself, so unsaved edits can't resurrect
 *     an image the user removed
 *   - The assets folder is resolved from the document's DIRECTORY, so every
 *     document in that directory shares it. An image the subject does not
 *     reference may still belong to a sibling, so candidates are checked against
 *     sibling documents before deletion
 *   - Siblings are read from disk UNLESS the caller supplies `knownContents` for
 *     them. An open tab that just pasted an image references it only in its
 *     unsaved buffer; disk alone would call that image an orphan and delete it
 *     out from under a document the user is still looking at
 *   - A scan that could not read everything reports `scanComplete: false` and
 *     protects every candidate. Deleting is the irreversible move; keeping a
 *     stray file is not
 *
 * @coordinates-with utils/imageReferences.ts — reference parsing and matching
 * @coordinates-with imageUtils.ts — ASSETS_FOLDER and isImageFile
 * @coordinates-with imageHandler/tiptap.ts — creates images in assets folder
 * @coordinates-with settingsStore.ts — autoCleanupEnabled user preference
 * @coordinates-with orphanCleanupPrompt.ts — the confirm-before-delete flow
 * @coordinates-with hooks/useTabOperations.ts — auto-cleanup on close
 * @module services/media/orphanAssetCleanup
 */

import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { ASSETS_FOLDER, isImageFile } from "@/utils/imageUtils";
import { isMarkdownFileName } from "@/utils/dropPaths";
import { assetKey, extractImageReferenceKeys } from "@/utils/imageReferences";
import { unregisterImageFilenames } from "@/services/media/imageHashRegistry";
import { canonicalPathKey } from "@/utils/paths/pathComparison";
import { orphanCleanupError } from "@/utils/debug";

export interface OrphanedImage {
  filename: string;
  fullPath: string;
}

export interface OrphanCleanupResult {
  orphanedImages: OrphanedImage[];
  /** Images referenced by the document being cleaned. */
  referencedCount: number;
  /** Images held by a sibling document sharing the same assets folder. */
  sharedCount: number;
  totalInFolder: number;
  /**
   * False when a sibling document or the directory itself could not be read.
   * Every candidate was protected, so "no orphans" means "could not tell",
   * not "nothing to clean" — callers must not report it as the latter.
   */
  scanComplete: boolean;
}

export interface OrphanScanOptions {
  /**
   * Authoritative content for documents the caller already holds, keyed by
   * absolute path — open tabs whose buffer is ahead of disk, and other
   * documents closing in the same batch. Consulted instead of reading the file.
   */
  knownContents?: ReadonlyMap<string, string>;
}

/** How many sibling documents to read at once. Unbounded `Promise.all` over a
 *  large notes folder exhausts file descriptors and stalls window close. */
const SIBLING_READ_CONCURRENCY = 8;

/**
 * Is `filename` in the assets folder referenced by any key in `refs`?
 *
 * Matches on the `assets/images/<name>` SUFFIX rather than on equality, because
 * the same file is legitimately written several ways: relative from the
 * document (`assets/images/x.png`), absolute (`/notes/assets/images/x.png`), or
 * from a subdirectory (`../assets/images/x.png`). Requiring exact equality
 * treated every non-relative spelling as unreferenced — and deleted the file.
 * A suffix match can only ever protect more, which is the safe direction.
 */
function isReferenced(refs: ReadonlySet<string>, filename: string): boolean {
  const suffix = assetKey(`${ASSETS_FOLDER}/${filename}`);
  if (refs.has(suffix)) return true;
  for (const ref of refs) {
    if (ref.endsWith(`/${suffix}`)) return true;
  }
  return false;
}

/** True when `filePath` sits directly in `dir` (not in a subdirectory). */
function isSameDirectory(filePath: string, dir: string): boolean {
  const cut = filePath.lastIndexOf("/");
  return cut !== -1 && filePath.slice(0, cut) === dir;
}

const emptyResult = (scanComplete = true): OrphanCleanupResult => ({
  orphanedImages: [],
  referencedCount: 0,
  sharedCount: 0,
  totalInFolder: 0,
  scanComplete,
});

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

interface SiblingScan {
  /** Reference keys held by the other documents sharing this assets folder. */
  keys: Set<string>;
  /** False if any sibling (or the directory listing) could not be read. */
  complete: boolean;
}

/**
 * Collect every image reference held by the OTHER documents in `docDir`, which
 * share this assets folder.
 */
async function collectSiblingReferences(
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

/**
 * Find orphaned images in the assets folder: present on disk, referenced
 * neither by `documentContent` nor by any sibling document sharing the folder.
 */
export async function findOrphanedImages(
  documentPath: string,
  documentContent: string,
  options: OrphanScanOptions = {}
): Promise<OrphanCleanupResult> {
  const knownContents = options.knownContents ?? new Map<string, string>();
  const docDir = await dirname(documentPath);
  const assetsPath = await join(docDir, ASSETS_FOLDER);

  const assetsExists = await exists(assetsPath);
  if (!assetsExists) return emptyResult();

  const entries = await readDir(assetsPath);
  const imageFiles = entries.filter((entry) => entry.isFile && isImageFile(entry.name));

  const refs = extractImageReferenceKeys(documentContent);

  const candidates: string[] = [];
  let referencedCount = 0;

  for (const entry of imageFiles) {
    if (isReferenced(refs, entry.name)) {
      referencedCount++;
    } else {
      candidates.push(entry.name);
    }
  }

  // Nothing to delete → no reason to pay for the sibling scan.
  if (candidates.length === 0) {
    return { ...emptyResult(), referencedCount, totalInFolder: imageFiles.length };
  }

  const siblings = await collectSiblingReferences(docDir, documentPath, knownContents);

  const orphanedImages: OrphanedImage[] = [];
  let sharedCount = 0;

  for (const filename of candidates) {
    // An incomplete scan means "we don't know" — keep the file. A stray image
    // costs disk; a wrong delete costs a document's picture.
    if (!siblings.complete || isReferenced(siblings.keys, filename)) {
      sharedCount++;
      continue;
    }
    orphanedImages.push({ filename, fullPath: await join(assetsPath, filename) });
  }

  return {
    orphanedImages,
    referencedCount,
    sharedCount,
    totalInFolder: imageFiles.length,
    scanComplete: siblings.complete,
  };
}

/** Outcome of a delete pass — partial failure is normal (permissions, races). */
export interface DeleteOutcome {
  deleted: number;
  /** Filenames that could not be removed. */
  failed: string[];
}

/** Shape returned by the Rust `move_paths_to_trash` command. */
interface TrashOutcome {
  trashed: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Remove orphaned images by moving them to the SYSTEM TRASH (WI-12), never by
 * unlinking. This code deletes files on INFERENCE — a scan concluding "nothing
 * references this" — and the trash turns every wrong conclusion from data loss
 * into an undo. A path the OS cannot trash is reported as failed and KEPT;
 * falling back to permanent deletion would defeat the point.
 *
 * Also reconciles the shared image-hash registry (WI-8a): entries for removed
 * files would otherwise "dedup" a future identical paste onto a path that no
 * longer exists.
 *
 * Never throws: a file that disappeared or is locked is reported, not
 * escalated.
 */
export async function deleteOrphanedImages(images: OrphanedImage[]): Promise<DeleteOutcome> {
  if (images.length === 0) return { deleted: 0, failed: [] };

  let outcome: TrashOutcome;
  try {
    outcome = await invoke<TrashOutcome>("move_paths_to_trash", {
      paths: images.map((img) => img.fullPath),
    });
  } catch (error) {
    orphanCleanupError(" Trash command failed:", error);
    return { deleted: 0, failed: images.map((img) => img.filename) };
  }

  const trashedPaths = new Set(outcome.trashed);
  const trashed = images.filter((img) => trashedPaths.has(img.fullPath));
  for (const failure of outcome.failed) {
    orphanCleanupError(` Failed to trash ${failure.path}:`, failure.error);
  }

  // Registry reconciliation is per assets folder; every image in one batch
  // shares the folder, so any member's path locates the registry. Best-effort:
  // a failure here leaves stale hashes, not lost files.
  if (trashed.length > 0) {
    try {
      const anchor = trashed[0].fullPath;
      const documentPath = anchor.slice(0, anchor.indexOf(`/${ASSETS_FOLDER}/`)) + "/anchor.md";
      await unregisterImageFilenames(documentPath, trashed.map((img) => img.filename));
    } catch (error) {
      orphanCleanupError(" Hash-registry reconciliation failed:", error);
    }
  }

  return {
    deleted: trashed.length,
    failed: images.filter((img) => !trashedPaths.has(img.fullPath)).map((img) => img.filename),
  };
}
