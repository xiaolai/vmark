/**
 * Path resolution helpers for the media preview popup.
 *
 * Resolves external URLs, absolute local paths, and document-relative paths
 * into `asset://` URLs that the webview can load. Decodes URL-encoded
 * segments (e.g. `%20` → space) so the file system sees real paths.
 *
 * @module plugins/imagePreview/resolveSrc
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { imagePreviewError } from "@/utils/debug";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { normalizePathForAsset } from "@/utils/resolveMediaSrc";

/** Maximum thumbnail dimensions (used by the view for initial positioning). */
export const MAX_THUMBNAIL_WIDTH = 200;
export const MAX_THUMBNAIL_HEIGHT = 150;

/** Media type for preview rendering. */
export type MediaType = "image" | "video" | "audio";

function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

/** Check if a path is an external URL (http/https/data). */
function isExternalUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

/** Check if a path is a document-relative path. */
function isRelativePath(src: string): boolean {
  return src.startsWith("./") || src.startsWith("assets/");
}

/** Check if a path is an absolute local path. */
function isAbsolutePath(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:/.test(src);
}

/**
 * Resolve a media path to an `asset://` URL for preview.
 * Decodes URL-encoded paths (e.g., `%20` -> space) for file system access.
 */
export async function resolveImageSrc(src: string): Promise<string> {
  // External URLs - use directly
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
