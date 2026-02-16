/**
 * Shared Media Source Resolution
 *
 * Purpose: Resolves media src attributes (image, audio, video) from markdown
 * node attributes to loadable URLs — handles external URLs, absolute paths,
 * and relative paths resolved against the active document's directory.
 *
 * Key decisions:
 *   - Async because relative paths need the document's directory from Tauri path API
 *   - Uses convertFileSrc to turn local file paths into Tauri asset:// protocol URLs
 *   - Windows path normalization handles backslash-to-forward-slash conversion
 *   - Security: relative paths are validated against directory traversal attacks
 *
 * @coordinates-with plugins/imageView/security.ts — path validation and URL classification
 * @coordinates-with stores/documentStore.ts — document file path lookup
 * @coordinates-with stores/tabStore.ts — active tab lookup
 * @module utils/resolveMediaSrc
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import {
  isAbsolutePath,
  isExternalUrl,
  isRelativePath,
  validateImagePath,
} from "@/plugins/imageView/security";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";

/**
 * Normalize path for convertFileSrc on Windows.
 * Windows paths use backslashes which convertFileSrc doesn't handle correctly.
 * See: https://github.com/tauri-apps/tauri/issues/7970
 */
export function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Get the active tab ID for the current window.
 * Returns null if no active tab or if the window label cannot be determined.
 */
export function getActiveTabIdForCurrentWindow(): string | null {
  try {
    const windowLabel = getWindowLabel();
    return useTabStore.getState().activeTabId[windowLabel] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a media src attribute to a loadable URL.
 *
 * - External URLs (http, https, data:, asset://, tauri://) pass through unchanged
 * - Absolute paths are converted via convertFileSrc with Windows normalization
 * - Relative paths are resolved against the active document's directory
 * - Invalid paths (directory traversal) return empty string
 *
 * @param src - Raw src from node attributes
 * @param logPrefix - Optional prefix for console warnings (e.g., "[BlockImageView]")
 * @returns Resolved URL suitable for element src
 */
export async function resolveMediaSrc(
  src: string,
  logPrefix = "[Media]",
): Promise<string> {
  if (isExternalUrl(src)) return src;

  // Decode URL-encoded paths for file system access
  // Markdown may contain %20 for spaces, or angle-bracket syntax
  const decodedSrc = decodeMarkdownUrl(src);

  if (isAbsolutePath(decodedSrc))
    return convertFileSrc(normalizePathForAsset(decodedSrc));

  // Reject paths with directory traversal regardless of prefix
  if (decodedSrc.includes("..")) {
    console.warn(`${logPrefix} Rejected path with directory traversal:`, decodedSrc);
    return "";
  }

  if (isRelativePath(decodedSrc)) {
    if (!validateImagePath(decodedSrc)) {
      console.warn(`${logPrefix} Rejected invalid media path:`, decodedSrc);
      return "";
    }

    const tabId = getActiveTabIdForCurrentWindow();
    const doc = tabId
      ? useDocumentStore.getState().getDocument(tabId)
      : undefined;
    const filePath = doc?.filePath;
    if (!filePath) return src;

    try {
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      console.error("Failed to resolve media path:", error);
      return src;
    }
  }

  return src;
}
