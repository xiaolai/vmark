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

import { readDir, exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { ASSETS_FOLDER, isImageFile } from "@/utils/imageUtils";
import { assetKey, extractImageReferenceKeys } from "@/utils/imageReferences";
import { unregisterImageFilenames } from "@/services/media/imageHashRegistry";
import { collectSiblingReferences } from "@/services/media/siblingReferences";
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
  /**
   * Reference keys from OTHER WINDOWS' live buffers (WI-9). `complete: false`
   * — any window unheard from — makes the whole scan incomplete, and an
   * incomplete scan protects every candidate. Absent means the caller has no
   * cross-window source (unit tests, single-surface flows): neutral.
   */
  externalRefKeys?: { complete: boolean; keys: ReadonlySet<string> };
}

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

const emptyResult = (scanComplete = true): OrphanCleanupResult => ({
  orphanedImages: [],
  referencedCount: 0,
  sharedCount: 0,
  totalInFolder: 0,
  scanComplete,
});

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
  // WI-9: fold in other windows' live buffers. Their keys only ever protect;
  // their absence (incomplete) poisons completeness, which also protects.
  const external = options.externalRefKeys;
  if (external) {
    external.keys.forEach((key) => siblings.keys.add(key));
    siblings.complete = siblings.complete && external.complete;
  }

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
