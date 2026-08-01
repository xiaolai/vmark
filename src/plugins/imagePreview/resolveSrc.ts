/**
 * Path resolution helpers for the media preview popup.
 *
 * Resolves external URLs, absolute local paths, and document-relative paths
 * into `asset://` URLs that the webview can load. Decodes URL-encoded
 * segments (e.g. `%20` → space) so the file system sees real paths.
 *
 * @module plugins/imagePreview/resolveSrc
 */

import { hostDocument } from "@/plugins/shared/hostDocument";
import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { imagePreviewError } from "@/utils/debug";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { normalizePathForAsset } from "@/services/media/resolveMediaSrc";
import {
  isAbsolutePath,
  isExternalUrl,
  isRelativePath,
  validateImagePath,
} from "@/plugins/shared/mediaSecurity";

/** Maximum thumbnail dimensions (used by the view for initial positioning). */
export const MAX_THUMBNAIL_WIDTH = 200;
export const MAX_THUMBNAIL_HEIGHT = 150;

/** Media type for preview rendering. */
export type MediaType = "image" | "video" | "audio";

function getActiveFilePath(): string | null {
  try {
    // Through the host seam, not the app's stores: this is ambient editor
    // context read by a leaf resolver, well below any extension option that
    // could carry it. See plugins/shared/hostDocument.ts.
    return hostDocument.activeFilePath(getWindowLabel());
  } catch {
    return null;
  }
}

/**
 * Resolve a media path to an `asset://` URL for preview.
 * Decodes URL-encoded paths (e.g., `%20` -> space) for file system access.
 *
 * Path classification is shared with the editor NodeView via
 * `plugins/shared/mediaSecurity` so the popup and the inline image agree on
 * what counts as relative/absolute/external — a bare relative path like
 * `evidence/page-1.png` resolves the same in both (issue #1086, fix #4).
 */
export async function resolveImageSrc(src: string): Promise<string> {
  // External URLs (http/https/data/asset:/tauri:) - use directly
  if (isExternalUrl(src)) {
    return src;
  }

  // Decode URL-encoded paths for file system access
  const decodedSrc = decodeMarkdownUrl(src);

  // Absolute local paths - convert to asset:// URL
  if (isAbsolutePath(decodedSrc)) {
    return convertFileSrc(normalizePathForAsset(decodedSrc));
  }

  // Relative paths - resolve against document directory
  if (isRelativePath(decodedSrc)) {
    // Validate against directory traversal (mirrors the editor NodeView).
    if (!validateImagePath(decodedSrc)) {
      imagePreviewError("Rejected invalid image path:", decodedSrc);
      return "";
    }

    const filePath = getActiveFilePath();
    if (!filePath) {
      return src;
    }

    try {
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      imagePreviewError("Failed to resolve path:", error);
      return src;
    }
  }

  return src;
}
