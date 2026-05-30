/**
 * Image Path Detection Utility
 *
 * Detects image URLs and local file paths in text.
 * Used for smart image insertion from clipboard.
 */

import { IMAGE_EXTENSIONS_DOTTED } from "./mediaExtensions";

/**
 * Supported image file extensions (dotted form). Single source of truth so
 * every detection path agrees (WI-0.6, D3).
 */
export const IMAGE_EXTENSIONS = IMAGE_EXTENSIONS_DOTTED;

/**
 * Result of image path detection.
 */
export interface ImagePathResult {
  /** Whether a valid image path was detected */
  isImage: boolean;
  /** Type of path detected */
  type: "url" | "dataUrl" | "absolutePath" | "relativePath" | "homePath" | "none";
  /** The detected path (first line, trimmed) */
  path: string;
  /** Whether the path needs to be copied to assets folder */
  needsCopy: boolean;
  /** Original input text */
  originalText: string;
}

/**
 * Check if a path has an image file extension.
 * Handles URLs with query params and fragments.
 */
export function hasImageExtension(path: string): boolean {
  // Remove query params and fragments for extension check
  const cleanPath = path.toLowerCase().split("?")[0].split("#")[0];
  return IMAGE_EXTENSIONS.some((ext) => cleanPath.endsWith(ext));
}

/**
 * Check if text is a data: URL for images.
 */
function isDataImageUrl(text: string): boolean {
  return text.startsWith("data:image/");
}

/**
 * Check if text is an HTTP/HTTPS URL.
 */
function isHttpUrl(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/**
 * Check if text is a file:// URL.
 * Handles both file:// and file:/// formats.
 */
function isFileUrl(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith("file://");
}

/**
 * Check if text is an absolute Unix path.
 * e.g., /Users/name/photo.png
 */
function isUnixAbsolutePath(text: string): boolean {
  return text.startsWith("/") && !text.startsWith("//");
}

/**
 * Check if text is an absolute Windows path.
 * e.g., C:\Users\name\photo.png or C:/Users/name/photo.png
 */
function isWindowsAbsolutePath(text: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(text);
}

/**
 * Check if text is a home directory path.
 * e.g., ~/Pictures/photo.png
 */
function isHomePath(text: string): boolean {
  return text.startsWith("~/");
}

/**
 * Check if text is a relative path.
 * e.g., ./assets/image.png, ../images/photo.jpg, or images/photo.jpg
 * A bare filename/path (no prefix) is also relative.
 */
function isRelativePath(text: string): boolean {
  // Explicit relative prefixes
  if (text.startsWith("./") || text.startsWith("../")) return true;
  // Bare paths: not a URL, not absolute, not home, not UNC — treat as relative
  if (
    !isUnixAbsolutePath(text) &&
    !isWindowsAbsolutePath(text) &&
    !isHomePath(text) &&
    !text.startsWith("~") &&
    !text.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(text)
  ) {
    return true;
  }
  return false;
}

/**
 * Detect and classify an image path from text.
 *
 * @param text - The text to check for image path patterns
 * @returns Detection result with path type and metadata
 *
 * @example
 * detectImagePath("https://example.com/photo.png")
 * // { isImage: true, type: "url", path: "https://...", needsCopy: false }
 *
 * detectImagePath("/Users/name/photo.jpg")
 * // { isImage: true, type: "absolutePath", path: "/Users/...", needsCopy: true }
 *
 * detectImagePath("./assets/image.png")
 * // { isImage: true, type: "relativePath", path: "./assets/...", needsCopy: false }
 */
export function detectImagePath(text: string): ImagePathResult {
  const trimmed = text.trim();

  // Empty text
  if (!trimmed) {
    return { isImage: false, type: "none", path: "", needsCopy: false, originalText: text };
  }

  // Only use first line (for multi-line clipboard content)
  const firstLine = trimmed.split("\n")[0].trim();
  /* v8 ignore start -- firstLine is always truthy when trimmed is non-empty; defensive guard */
  if (!firstLine) {
    return { isImage: false, type: "none", path: "", needsCopy: false, originalText: text };
  }
  /* v8 ignore stop */

  // Check for data: image URL (always valid, no extension check needed)
  if (isDataImageUrl(firstLine)) {
    return {
      isImage: true,
      type: "dataUrl",
      path: firstLine,
      needsCopy: false,
      originalText: text,
    };
  }

  // For all other types, require image extension
  if (!hasImageExtension(firstLine)) {
    return { isImage: false, type: "none", path: "", needsCopy: false, originalText: text };
  }

  // HTTP/HTTPS URL
  if (isHttpUrl(firstLine)) {
    return {
      isImage: true,
      type: "url",
      path: firstLine,
      needsCopy: false,
      originalText: text,
    };
  }

  // file:// URL - treat as absolute path, needs copy
  // file:///path/to/file -> /path/to/file (Unix)
  // file://hostname/path -> /path (network, rare)
  if (isFileUrl(firstLine)) {
    // Remove "file://" prefix only, preserving the path's leading slash
    const path = firstLine.replace(/^file:\/\//, "");
    return {
      isImage: true,
      type: "absolutePath",
      path,
      needsCopy: true,
      originalText: text,
    };
  }

  // Absolute Unix path
  if (isUnixAbsolutePath(firstLine)) {
    return {
      isImage: true,
      type: "absolutePath",
      path: firstLine,
      needsCopy: true,
      originalText: text,
    };
  }

  // Absolute Windows path
  if (isWindowsAbsolutePath(firstLine)) {
    return {
      isImage: true,
      type: "absolutePath",
      path: firstLine,
      needsCopy: true,
      originalText: text,
    };
  }

  // Home path
  if (isHomePath(firstLine)) {
    return {
      isImage: true,
      type: "homePath",
      path: firstLine,
      needsCopy: true,
      originalText: text,
    };
  }

  // Relative path
  if (isRelativePath(firstLine)) {
    return {
      isImage: true,
      type: "relativePath",
      path: firstLine,
      needsCopy: false, // Already relative, just verify and insert
      originalText: text,
    };
  }

  // Not a recognized image path
  return { isImage: false, type: "none", path: "", needsCopy: false, originalText: text };
}

/**
 * Result of detecting multiple image paths.
 */
export interface MultiImageDetectionResult {
  /** Whether ALL paths are valid images */
  allImages: boolean;
  /** Detection results for each path */
  results: ImagePathResult[];
  /** Count of valid images detected */
  imageCount: number;
}

/**
 * Detect if all paths are valid images.
 * Returns early (allImages: false) on first non-image path.
 *
 * @param paths - Array of paths to check
 * @returns Detection result with all individual results
 *
 * @example
 * detectMultipleImagePaths(['/path/to/a.png', '/path/to/b.jpg'])
 * // { allImages: true, results: [...], imageCount: 2 }
 *
 * @example
 * detectMultipleImagePaths(['/path/to/a.png', 'not an image'])
 * // { allImages: false, results: [...], imageCount: 1 }
 */
export function detectMultipleImagePaths(paths: string[]): MultiImageDetectionResult {
  if (paths.length === 0) {
    return { allImages: false, results: [], imageCount: 0 };
  }

  const results: ImagePathResult[] = [];

  for (const path of paths) {
    const result = detectImagePath(path);
    results.push(result);

    // Early return on first non-image
    if (!result.isImage) {
      return { allImages: false, results, imageCount: results.filter((r) => r.isImage).length };
    }
  }

  return { allImages: true, results, imageCount: results.length };
}
