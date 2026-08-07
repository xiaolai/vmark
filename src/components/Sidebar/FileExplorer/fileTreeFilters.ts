import type { DirectoryEntry } from "./types";

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
