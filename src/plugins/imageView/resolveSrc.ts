/**
 * Purpose: turn an image `src` written in Markdown into a URL the webview can load.
 *
 * Its own module, mirroring `imagePreview/resolveSrc.ts`, because the relative
 * branch is the only part of the node view with real decision logic — path
 * validation, a missing-document fallback, and an error path — and it was
 * unreachable from a test while it lived inside a ProseMirror NodeView.
 *
 * Key decisions:
 *   - The document path comes from the `hostDocument` seam, not the app's
 *     store, so the plugin stands alone (ADR-015).
 *   - A traversal-invalid relative path returns "" (render nothing), while an
 *     unresolvable one returns the original `src` — a blank image is the safe
 *     answer only when the path is hostile, not when it is merely unresolved.
 *
 * @coordinates-with plugins/shared/hostDocument.ts — the document path seam
 * @coordinates-with plugins/imageView/plugin.ts — the node view that calls this
 * @module plugins/imageView/resolveSrc
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import {
  isRelativePath,
  isAbsolutePath,
  isExternalUrl,
  validateImagePath,
} from "../shared/mediaSecurity";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { normalizePathForAsset } from "@/services/media/resolveMediaSrc";
import { activeFilePathForCurrentWindow } from "@/plugins/shared/hostDocument";
import { imageViewWarn, imagePreviewError } from "@/utils/debug";

/**
 * Convert image path to asset URL for webview rendering.
 * Handles: relative paths, absolute paths, and external URLs.
 * Decodes URL-encoded paths (e.g., %20 -> space) for file system access.
 */
export async function resolveImageSrc(src: string): Promise<string> {
  // External URLs (http/https/data) - use directly
  if (isExternalUrl(src)) {
    return src;
  }

  // Decode URL-encoded paths for file system access
  // Markdown may contain %20 for spaces, but filesystem needs actual spaces
  const decodedSrc = decodeMarkdownUrl(src);

  // Absolute local paths - convert to asset:// URL
  if (isAbsolutePath(decodedSrc)) {
    return convertFileSrc(normalizePathForAsset(decodedSrc));
  }

  // Relative paths - resolve against document directory
  if (isRelativePath(decodedSrc)) {
    // Validate path to prevent traversal attacks
    if (!validateImagePath(decodedSrc)) {
      imageViewWarn("Rejected invalid image path:", decodedSrc);
      return "";
    }

    try {
      const filePath = activeFilePathForCurrentWindow();
      if (!filePath) {
        return src; // No document path, can't resolve
      }
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      imagePreviewError("Failed to resolve image path:", error);
      return src;
    }
  }

  // Unknown format - return as-is
  return src;
}
