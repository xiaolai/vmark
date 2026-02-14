/**
 * Path Normalization Helpers
 *
 * Purpose: Centralized, cross-platform path utilities for workspace boundary checks.
 * All functions normalize paths to use forward slashes for consistency.
 *
 * IMPORTANT: These helpers work with path strings only — no filesystem access.
 * They must remain pure and framework-free (no Tauri, React, etc.).
 *
 * Key decisions:
 *   - Forward slashes everywhere (even on Windows) to avoid escape issues
 *   - isWithinRoot uses boundary checking (root + "/") to prevent substring false positives
 *   - isPathExcluded matches against path segments, not substrings, for accuracy
 *
 * @coordinates-with openPolicy.ts — uses isWithinRoot for workspace boundary decisions
 * @coordinates-with pathReconciliation.ts — uses normalizePath for path comparison
 * @coordinates-with fileTreeFilters.ts — uses isPathExcluded for file explorer filtering
 * @module utils/paths/paths
 */

/**
 * Normalize a path to use forward slashes and remove trailing slashes.
 * Works with both Windows (backslash) and POSIX (forward slash) paths.
 *
 * @param path - The path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePath(path: string): string {
  if (!path) return "";

  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, "/");

  // Remove trailing slashes (but not the root slash)
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Get the filename from a path (last segment).
 *
 * @param path - The file path
 * @returns The filename, or empty string if path ends with separator
 */
export function getFileName(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return "";

  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Get the parent directory of a path.
 *
 * @param path - The file path
 * @returns The parent directory path, or empty string if at root
 */
export function getParentDir(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return "";

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return "";
  if (lastSlash === 0) return "";

  return normalized.slice(0, lastSlash);
}

/**
 * Get the relative path from a root to a target path.
 * If target is not within root, returns the normalized target path.
 *
 * @param rootPath - The root/base path
 * @param targetPath - The target path
 * @returns Relative path from root, or full target path if not within root
 */
export function getRelativePath(rootPath: string, targetPath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);

  if (!isWithinRoot(rootPath, targetPath)) {
    return normalizedTarget;
  }

  // Remove root prefix
  const relative = normalizedTarget.slice(normalizedRoot.length);

  // Remove leading slash
  if (relative.startsWith("/")) {
    return relative.slice(1);
  }

  return relative || "";
}

/**
 * Check if a path is within (or equal to) a root path.
 * Uses path boundary checking to avoid false positives from substring matches.
 *
 * @param rootPath - The root path
 * @param targetPath - The path to check
 * @returns true if target is within or equal to root
 */
export function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);

  // Exact match
  if (normalizedTarget === normalizedRoot) {
    return true;
  }

  // Target must start with root + separator
  // This prevents "/Users/root" matching "/Users/rootother"
  return normalizedTarget.startsWith(normalizedRoot + "/");
}

/**
 * Split a path into segments (directory/file names).
 * Filters out empty segments from consecutive or trailing separators.
 *
 * @param path - The path to split
 * @returns Array of path segments
 */
export function pathSegments(path: string): string[] {
  const normalized = normalizePath(path);
  if (!normalized) return [];

  return normalized.split("/").filter((segment) => segment.length > 0);
}

/**
 * Check if a path should be excluded based on folder patterns.
 * Matches against path segments (not substrings) for accuracy.
 *
 * @param path - The full file path
 * @param rootPath - The workspace root path
 * @param excludeFolders - List of folder names to exclude
 * @returns true if path should be excluded
 */
export function isPathExcluded(
  path: string,
  rootPath: string,
  excludeFolders: string[]
): boolean {
  if (!excludeFolders.length) return false;

  const relativePath = getRelativePath(rootPath, path);
  const segments = pathSegments(relativePath);

  return segments.some((segment) => excludeFolders.includes(segment));
}
