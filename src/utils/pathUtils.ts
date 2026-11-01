/**
 * Cross-platform Path Utilities
 *
 * Purpose: Simple path manipulation utilities that work with both Windows
 * (backslash) and POSIX (forward slash) paths without filesystem access.
 *
 * Key decisions:
 *   - A backslash is an ordinary filename character in a POSIX absolute path on
 *     macOS and Linux, and a separator everywhere else. Both conditions matter.
 *     Windows accepts a backslash in a "/"-rooted path too, so the shape alone
 *     would misread a containment check there; and a relative path or href may
 *     have been written on Windows, so the OS alone would break those. On Windows
 *     every path keeps splitting on both.
 *
 * Note: For workspace boundary checks, prefer paths/paths.ts which normalizes
 * to forward slashes. This file is for display-oriented utilities (filenames,
 * the translation key of the file manager label — utils/ cannot translate).
 *
 * @coordinates-with paths/paths.ts — more comprehensive path utilities with normalization
 * @coordinates-with platform.ts — the running OS, read at call time
 * @coordinates-with exportNaming.ts — uses getFileNameWithoutExtension for export filenames
 * @module utils/pathUtils
 */

import { getRuntimePlatform, type RuntimePlatform } from "./platform";

/**
 * One "/" that opens a POSIX absolute path. `//host` and `/\\host` are refused
 * because both are spellings of a UNC path; `///a` has no host and is POSIX.
 */
const POSIX_ABSOLUTE = /^\/(?!\\|\/[^/])/;

/** True when a backslash in `path` is part of a name, not a separator. See the header. */
export function backslashIsNameCharacter(
  path: string,
  platform: RuntimePlatform = getRuntimePlatform(),
): boolean {
  return platform !== "windows" && POSIX_ABSOLUTE.test(path);
}

/** `path` with its separators forward; a backslash that is part of a name stays. */
export function toForwardSlashes(
  path: string,
  platform: RuntimePlatform = getRuntimePlatform(),
): string {
  return backslashIsNameCharacter(path, platform) ? path : path.replace(/\\/g, "/");
}

/** `path` without trailing separators; a trailing backslash that is part of a name stays. */
export function withoutTrailingSeparators(
  path: string,
  platform: RuntimePlatform = getRuntimePlatform(),
): string {
  return path.replace(backslashIsNameCharacter(path, platform) ? /\/+$/ : /[/\\]+$/, "");
}

/** The separator `path` itself uses, for building a sibling or display form. */
export function pathSeparator(path: string): "/" | "\\" {
  return !backslashIsNameCharacter(path) && path.includes("\\") ? "\\" : "/";
}

/** Index of the separator before the path's last segment, or -1 if it has none. */
function lastSeparatorIndex(path: string): number {
  const lastSlash = path.lastIndexOf("/");
  return backslashIsNameCharacter(path) ? lastSlash : Math.max(lastSlash, path.lastIndexOf("\\"));
}

/**
 * Extract the filename from a path (works for both Windows and POSIX).
 */
export function getFileName(filePath: string): string {
  const lastSlash = lastSeparatorIndex(filePath);
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
  const lastSlash = lastSeparatorIndex(filePath);
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  const dir = filePath.slice(0, lastSlash);
  if (/^[A-Za-z]:$/.test(dir)) return dir + "\\";
  return dir;
}

/**
 * Join directory and filename with appropriate separator.
 * Detects separator from directory path, defaults to forward slash.
 */
export function joinPath(directory: string, filename: string): string {
  if (!directory) return filename;
  const separator = pathSeparator(directory);
  // Remove trailing separator if present
  const cleanDir = directory.endsWith(separator)
    ? directory.slice(0, -1)
    : directory;
  return `${cleanDir}${separator}${filename}`;
}

/** Translation key of a "reveal in file manager" label, namespace included. */
export type RevealInFileManagerKey =
  | "sidebar:contextMenu.revealInFinder"
  | "sidebar:contextMenu.showInExplorer"
  | "sidebar:contextMenu.showInFileManager";

/**
 * Platform-appropriate translation key for the "reveal in file manager"
 * action — Finder on macOS, Explorer on Windows, the file manager elsewhere.
 * Callers translate it; every menu that offers the action uses this one rule.
 */
export function revealInFileManagerKey(): RevealInFileManagerKey {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "sidebar:contextMenu.revealInFinder";
  if (platform.includes("win")) return "sidebar:contextMenu.showInExplorer";
  return "sidebar:contextMenu.showInFileManager";
}
