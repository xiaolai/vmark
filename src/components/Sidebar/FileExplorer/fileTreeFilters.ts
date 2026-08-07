import type { DirectoryEntry } from "./types";
import { isMarkdownFileName } from "@/utils/dropPaths";
import { formatFileDisplayName } from "@/utils/displayFileName";

/** Options controlling which file tree entries are visible. */
export interface FileTreeFilterOptions {
  showHidden: boolean;
  showAllFiles: boolean;
  excludeFolders: string[];
  filter: (name: string, isFolder: boolean) => boolean;
}

/** Determine whether a directory entry should be shown based on visibility and filter options. */
export function shouldIncludeEntry(
  entry: DirectoryEntry,
  options: FileTreeFilterOptions
): boolean {
  if (!options.showHidden && entry.isHidden) return false;
  if (entry.isDirectory && options.excludeFolders.includes(entry.name)) return false;
  if (options.showAllFiles) return true;
  return options.filter(entry.name, entry.isDirectory);
}

/**
 * The label the tree shows for a file.
 *
 * fix(#1224) — `showExtensions` (default on) shows the name as it is on disk.
 * With it off, the legacy rule applies: markdown loses its suffix, and a
 * non-markdown file surfaced by `showAllFiles` keeps its own, because a bare
 * "data" sitting next to "data.json" tells the reader nothing.
 */
export function fileTreeDisplayName(
  name: string,
  options: { showExtensions: boolean; showAllFiles: boolean }
): string {
  if (options.showExtensions) return name;
  if (options.showAllFiles && !isMarkdownFileName(name)) return name;
  return formatFileDisplayName(name, false);
}
