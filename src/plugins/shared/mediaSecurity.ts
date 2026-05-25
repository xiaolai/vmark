/**
 * Image Path Security
 *
 * Validates image paths to prevent path traversal attacks.
 */

import { imageViewWarn } from "@/utils/debug";

/**
 * Check if a path is relative.
 * A path is relative if it is not a URL, not absolute, not home-relative,
 * not parent traversal, and not degenerate (whitespace, dot-only).
 */
export function isRelativePath(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  // Reject any URI scheme (case-insensitive): http:, javascript:, blob:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (isAbsolutePath(trimmed)) return false;
  // Reject home-relative paths (~/)
  if (trimmed.startsWith("~/") || trimmed === "~") return false;
  // Reject parent traversal
  if (trimmed.startsWith("../") || trimmed === "..") return false;
  // Reject dot-only
  if (trimmed === ".") return false;
  return true;
}

/**
 * Check if a path is an absolute local file path.
 */
export function isAbsolutePath(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:/.test(src);
}

/**
 * Check if a path is an external URL (http/https/data) or Tauri asset URL.
 */
export function isExternalUrl(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("asset://") ||
    src.startsWith("tauri://")
  );
}

/**
 * Validate an image path for security.
 * Rejects paths that attempt path traversal via `..` segments.
 */
export function validateImagePath(src: string): boolean {
  // Reject paths with ".." as a path segment (parent traversal)
  // Allows filenames like "my..photo.png" where ".." is not a segment
  const segments = src.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s === "..")) {
    return false;
  }

  // Reject absolute paths (could access system files)
  if (src.startsWith("/") || /^[A-Za-z]:/.test(src)) {
    return false;
  }

  // Allow relative paths (bare, ./ prefixed, or assets/)
  return isRelativePath(src);
}

/**
 * Sanitize and validate an image path.
 * Returns null if the path is invalid or malicious.
 */
export function sanitizeImagePath(src: string): string | null {
  if (!validateImagePath(src)) {
    imageViewWarn("Rejected suspicious image path:", src);
    return null;
  }
  return src;
}
