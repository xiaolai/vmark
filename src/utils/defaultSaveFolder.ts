/**
 * Default save folder resolution
 *
 * Pure helpers for determining the default folder for Save dialogs.
 * The async wrapper that gathers data from stores/Tauri lives in hooks layer.
 *
 * Precedence:
 * 1. Workspace root (if in workspace mode)
 * 2. Sibling tab's folder (any saved file open in the window)
 * 3. Documents/Home directory (fallback)
 *
 * @module utils/defaultSaveFolder
 */
import { getDirectory } from "@/utils/pathUtils";

/**
 * Input for default save folder resolution.
 * All data is pre-gathered by the caller (hook layer).
 */
export interface DefaultSaveFolderInput {
  /** Whether the window is in workspace mode */
  isWorkspaceMode: boolean;
  /** Workspace root path (if in workspace mode) */
  workspaceRoot: string | null;
  /** File paths of saved tabs in this window (in order) */
  savedFilePaths: string[];
  /** Fallback directory (Documents or Home) */
  fallbackDirectory: string;
}

/**
 * Resolve the default save folder.
 *
 * Pure function - takes all data as input, no side effects.
 *
 * Precedence:
 * 1. Workspace root - if in workspace mode with valid root
 * 2. Sibling tab folder - first saved file's directory
 * 3. Fallback directory (Documents/Home)
 *
 * @param input - Pre-gathered workspace and tab data
 * @returns The resolved default folder path
 *
 * @example
 * // In workspace mode - returns workspace root
 * resolveDefaultSaveFolder({
 *   isWorkspaceMode: true,
 *   workspaceRoot: "/workspace/project",
 *   savedFilePaths: [],
 *   fallbackDirectory: "/Users/test/Documents"
 * }); // Returns "/workspace/project"
 *
 * @example
 * // Not in workspace mode but saved tabs open - returns sibling folder
 * resolveDefaultSaveFolder({
 *   isWorkspaceMode: false,
 *   workspaceRoot: null,
 *   savedFilePaths: ["/other/path/file.md"],
 *   fallbackDirectory: "/Users/test/Documents"
 * }); // Returns "/other/path"
 */
export function resolveDefaultSaveFolder(input: DefaultSaveFolderInput): string {
  const { isWorkspaceMode, workspaceRoot, savedFilePaths, fallbackDirectory } = input;

  // 1. Workspace root first (if in workspace mode)
  if (isWorkspaceMode && workspaceRoot) {
    return workspaceRoot;
  }

  // 2. Sibling tab folder — if any saved file is open, save next to it
  //    This keeps related files together regardless of workspace mode
  for (const filePath of savedFilePaths) {
    const dir = getDirectory(filePath);
    if (dir) return dir;
  }

  // 3. Final fallback: Documents/Home directory
  return fallbackDirectory;
}

// Note: The async wrapper getDefaultSaveFolderWithFallback is now in
// @/hooks/useDefaultSaveFolder. Import from there for Tauri/store integration.
