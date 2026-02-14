/**
 * Orphan Asset Cleanup
 *
 * Purpose: Finds and removes images in the assets folder that are no longer
 * referenced in the document. Prevents asset folder bloat from deleted images.
 *
 * Key decisions:
 *   - Scans both markdown image syntax and HTML img tags for references
 *   - Shows confirmation dialog before deletion (with preview of up to 10 files)
 *   - Can be triggered manually or auto-run on document close (setting-controlled)
 *   - Requires saved document — refuses to run on unsaved/dirty docs to avoid
 *     incorrectly identifying referenced images as orphans
 *
 * @coordinates-with imageUtils.ts — ASSETS_FOLDER and IMAGE_EXTENSIONS constants
 * @coordinates-with imageHandler/tiptap.ts — creates images in assets folder
 * @coordinates-with settingsStore.ts — autoCleanupEnabled user preference
 * @module utils/orphanAssetCleanup
 */

import { readDir, remove, exists } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { ASSETS_FOLDER, IMAGE_EXTENSIONS } from "./imageUtils";

export interface OrphanedImage {
  filename: string;
  fullPath: string;
}

export interface OrphanCleanupResult {
  orphanedImages: OrphanedImage[];
  referencedCount: number;
  totalInFolder: number;
}

/**
 * Check if a file is an image based on extension.
 */
function isImageExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext || "");
}

/**
 * Extract all image references from markdown content.
 * Handles both inline images ![alt](path) and block images.
 * Exported for testing.
 */
export function extractImageReferences(content: string): Set<string> {
  const refs = new Set<string>();

  // Match markdown image syntax:
  // - ![alt](path) or ![alt](path "title")
  // - ![alt](<path with spaces>) - angle bracket syntax
  const imageRegex = /!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    // Group 1 is angle-bracket path, Group 2 is regular path
    const path = match[1] || match[2];
    if (!path) continue;
    // Normalize path: remove leading ./ if present, decode URL encoding
    let normalized = path.startsWith("./") ? path.slice(2) : path;
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // If decoding fails, use as-is
    }
    refs.add(normalized);
  }

  // Also match HTML img tags: <img src="path" ...>
  const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgTagRegex.exec(content)) !== null) {
    const path = match[1];
    let normalized = path.startsWith("./") ? path.slice(2) : path;
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // If decoding fails, use as-is
    }
    refs.add(normalized);
  }

  return refs;
}

/**
 * Find orphaned images in the assets folder.
 * Returns images that exist in the folder but aren't referenced in the document.
 */
export async function findOrphanedImages(
  documentPath: string,
  documentContent: string
): Promise<OrphanCleanupResult> {
  const docDir = await dirname(documentPath);
  const assetsPath = await join(docDir, ASSETS_FOLDER);

  // Check if assets folder exists
  const assetsExists = await exists(assetsPath);
  if (!assetsExists) {
    return { orphanedImages: [], referencedCount: 0, totalInFolder: 0 };
  }

  // Read all files in assets folder
  const entries = await readDir(assetsPath);
  const imageFiles = entries.filter(
    (entry) => entry.isFile && isImageExtension(entry.name)
  );

  // Extract references from document
  const refs = extractImageReferences(documentContent);

  // Find orphans: images in folder but not in references
  const orphanedImages: OrphanedImage[] = [];
  let referencedCount = 0;

  for (const entry of imageFiles) {
    const filename = entry.name;
    // Build the expected reference path
    const refPath = `${ASSETS_FOLDER}/${filename}`;

    if (refs.has(refPath)) {
      referencedCount++;
    } else {
      orphanedImages.push({
        filename,
        fullPath: await join(assetsPath, filename),
      });
    }
  }

  return {
    orphanedImages,
    referencedCount,
    totalInFolder: imageFiles.length,
  };
}

/**
 * Delete orphaned images from the assets folder.
 */
export async function deleteOrphanedImages(images: OrphanedImage[]): Promise<number> {
  let deletedCount = 0;

  for (const image of images) {
    try {
      await remove(image.fullPath);
      deletedCount++;
    } catch (error) {
      console.error(`[OrphanCleanup] Failed to delete ${image.filename}:`, error);
    }
  }

  return deletedCount;
}

/**
 * Show orphan cleanup preview and optionally delete with confirmation.
 * Returns the number of deleted images, or -1 if cancelled/no orphans.
 *
 * @param documentPath - Path to the document file, or null if unsaved
 * @param documentContent - Document content to analyze, or null if document has unsaved changes
 * @param autoCleanupEnabled - Whether auto-cleanup on close is enabled
 */
export async function runOrphanCleanup(
  documentPath: string | null,
  documentContent: string | null,
  autoCleanupEnabled = false
): Promise<number> {
  if (!documentPath) {
    await message("Please save the document first before checking for unused images.", {
      title: "Unsaved Document",
      kind: "warning",
    });
    return -1;
  }

  if (documentContent === null) {
    await message(
      "Please save your changes first before checking for unused images.\n\n" +
        "This ensures the check analyzes your saved content.",
      {
        title: "Unsaved Changes",
        kind: "warning",
      }
    );
    return -1;
  }

  // Find orphaned images
  const result = await findOrphanedImages(documentPath, documentContent);

  if (result.orphanedImages.length === 0) {
    await message(
      `No unused images found.\n\n` +
        `Assets folder has ${result.totalInFolder} image(s), all are referenced in the document.`,
      { title: "Image Status", kind: "info" }
    );
    return 0;
  }

  // Show list of orphans
  const orphanList = result.orphanedImages
    .slice(0, 10)
    .map((img) => `• ${img.filename}`)
    .join("\n");
  const moreText =
    result.orphanedImages.length > 10
      ? `\n... and ${result.orphanedImages.length - 10} more`
      : "";

  const settingHint = autoCleanupEnabled
    ? "\n\nThese will be automatically deleted when you close this document."
    : "\n\nTip: Enable \"Clean up unused images on close\" in Settings → Images " +
      "to automatically remove these when closing the document.";

  const confirmed = await confirm(
    `Found ${result.orphanedImages.length} unused image(s) not referenced in the document:\n\n` +
      `${orphanList}${moreText}${settingHint}\n\n` +
      `Delete these images now?`,
    { title: "Unused Images", kind: "warning", okLabel: "Delete Now", cancelLabel: "Later" }
  );

  if (!confirmed) {
    return -1;
  }

  // Delete orphaned images
  const deletedCount = await deleteOrphanedImages(result.orphanedImages);

  await message(`Deleted ${deletedCount} orphaned image(s).`, {
    title: "Cleanup Complete",
    kind: "info",
  });

  return deletedCount;
}
