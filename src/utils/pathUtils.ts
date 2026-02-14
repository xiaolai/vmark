/**
 * Cross-platform Path Utilities
 *
 * Purpose: Simple path manipulation utilities that work with both Windows
 * (backslash) and POSIX (forward slash) paths without filesystem access.
 *
 * Note: For workspace boundary checks, prefer paths/paths.ts which normalizes
 * to forward slashes. This file is for display-oriented utilities (filenames,
 * file manager labels).
 *
 * @coordinates-with paths/paths.ts — more comprehensive path utilities with normalization
 * @coordinates-with exportNaming.ts — uses getFileNameWithoutExtension for export filenames
 * @module utils/pathUtils
 */

/**
 * Extract the filename from a path (works for both Windows and POSIX).
 */
export function getFileName(filePath: string): string {
  // Handle both forward and back slashes
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

/**
 * Extract the filename without extension.
 */
export function getFileNameWithoutExtension(filePath: string): string {
  const name = getFileName(filePath);
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

/**
 * Get the directory part of a path (works for both Windows and POSIX).
 */
export function getDirectory(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
}

/**
 * Join directory and filename with appropriate separator.
 * Detects separator from directory path, defaults to forward slash.
 */
export function joinPath(directory: string, filename: string): string {
  if (!directory) return filename;
  const separator = directory.includes("\\") ? "\\" : "/";
  // Remove trailing separator if present
  const cleanDir = directory.endsWith(separator)
    ? directory.slice(0, -1)
    : directory;
  return `${cleanDir}${separator}${filename}`;
}

/**
 * Get platform-appropriate label for "reveal in file manager" action.
 * - macOS: "Reveal in Finder"
 * - Windows: "Show in Explorer"
 * - Linux/other: "Show in File Manager"
 */
export function getRevealInFileManagerLabel(): string {
  if (typeof navigator === "undefined") return "Show in File Manager";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "Reveal in Finder";
  if (platform.includes("win")) return "Show in Explorer";
  return "Show in File Manager";
}
