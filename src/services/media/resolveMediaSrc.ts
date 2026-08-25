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
 *   - withMediaReloadKey() appends a version to that URL so a file changed on
 *     disk is re-fetched: an element whose `src` is unchanged never reloads,
 *     and the webview's cache defeats a fresh element too (issue #1328)
 *   - Windows path normalization handles backslash-to-forward-slash conversion
 *   - Security: relative paths are validated against directory traversal attacks
 *
 * @coordinates-with plugins/shared/mediaSecurity.ts — path validation and URL classification
 * @coordinates-with stores/documentStore.ts — document file path lookup
 * @coordinates-with stores/tabStore.ts — active tab lookup
 * @module utils/resolveMediaSrc
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import {
  isAbsolutePath,
  isExternalUrl,
  isRelativePath,
  validateImagePath,
} from "@/plugins/shared/mediaSecurity";
import { imageViewWarn, resolveMediaError } from "@/utils/debug";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";

/**
 * Normalize a filesystem path for use with Tauri's convertFileSrc().
 *
 * - Windows backslashes → forward slashes (tauri-apps/tauri#7970)
 *
 * NOTE: Do NOT percent-encode here. Tauri's convertFileSrc() already calls
 * encodeURIComponent() on the entire path (see @tauri-apps/api mocks.js:235).
 * Encoding here would double-encode and break the asset protocol (#752).
 */
export function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Append a reload key to an `asset://` URL so a changed file is re-fetched.
 *
 * An `<img>` / `<video>` whose `src` attribute does not change never refetches,
 * and the webview's cache means even a BRAND-NEW element pointed at the same
 * URL is served the bytes it already holds. Measured against real WebKit while
 * fixing issue #1328: with a 64×64 PNG open and a 96×96 one written over it,
 * a fresh `new Image()` on the unchanged URL still decoded 64×64, while the
 * same URL plus a query parameter decoded 96×96. So the URL has to move, and a
 * remount alone cannot substitute for it.
 *
 * `key === 0` returns the URL untouched: that is the state of every media view
 * that has never seen an external change, and a bare URL is what the existing
 * tests, the Quick Look overlay and the asset scope all already exercise.
 *
 * The parameter rides in the QUERY, which the asset protocol resolves the file
 * path independently of — verified live, not assumed.
 */
export function withMediaReloadKey(assetUrl: string, key: number): string {
  if (!Number.isFinite(key) || key <= 0) return assetUrl;
  return `${assetUrl}${assetUrl.includes("?") ? "&" : "?"}v=${key}`;
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

  // Reject paths with ".." as a path segment (parent traversal)
  const segments = decodedSrc.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s === "..")) {
    imageViewWarn(`${logPrefix} Rejected path with directory traversal:`, decodedSrc);
    return "";
  }

  if (isRelativePath(decodedSrc)) {
    /* v8 ignore start -- @preserve validateImagePath rejects only adversarial paths; tests use valid paths */
    if (!validateImagePath(decodedSrc)) {
      imageViewWarn(`${logPrefix} Rejected invalid media path:`, decodedSrc);
      return "";
    }
    /* v8 ignore stop */

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
      resolveMediaError("Failed to resolve media path:", error);
      return src;
    }
  }

  return src;
}
