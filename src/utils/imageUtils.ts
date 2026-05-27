/**
 * Image Utilities (Pure)
 *
 * Pure helper functions for image handling:
 * - File extension checking
 * - Filename extraction and generation
 * - Relative path construction
 *
 * Async operations (mkdir, copyFile, etc.) are in hooks/useImageOperations.
 */

export const ASSETS_FOLDER = "assets/images";

/**
 * Supported image extensions.
 */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

/**
 * Check if a filename has an image extension.
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext || "");
}

/**
 * Extract filename from a path (handles both / and \ separators).
 */
export function getFilename(path: string): string {
  return path.split(/[/\\]/).pop() || "image.png";
}

/**
 * Generate a unique filename using timestamp and random suffix.
 * Format: {basename}-{timestamp}-{random8}.{ext}
 */
export function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  // 8 base-36 chars (~2.8×10¹² combinations). 4 chars (1.68M) tripped
  // the 100-pick uniqueness test ~0.36% per run because a tight loop
  // shares one Date.now() ms, leaving the suffix as the only
  // differentiator — and the same collision surfaces in batch image paste.
  const random = Math.random().toString(36).substring(2, 10);

  // Extract and sanitize base name
  const baseName = originalName
    .replace(/\.[^.]+$/, "") // Remove extension
    .replace(/[^a-zA-Z0-9-_]/g, "_") // Replace special chars
    .substring(0, 50); // Limit length

  // Get extension
  const ext = originalName.split(".").pop()?.toLowerCase() || "png";

  return `${baseName}-${timestamp}-${random}.${ext}`;
}

/**
 * Build the relative path for an image in the assets folder.
 * Pure function - doesn't touch file system.
 */
export function buildAssetRelativePath(filename: string): string {
  return `./${ASSETS_FOLDER}/${filename}`;
}
