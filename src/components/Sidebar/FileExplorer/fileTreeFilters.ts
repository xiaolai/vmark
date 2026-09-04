import type { DirectoryEntry } from "./types";

/**
 * Directory names the file tree never descends, whatever the workspace config
 * says (#1357). The same floor the workspace search applies — mirrors
 * `ALWAYS_SKIP` in `src-tauri/src/content_search_match.rs`, pinned identical by
 * `fileTreeFilters.test.ts`. The Rust tree walker prunes these before reading them;
 * this list keeps a client-side listing honest about the same names.
 */
export const FILE_TREE_ALWAYS_SKIP: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".obsidian",
  ".svn",
  "__pycache__",
  ".DS_Store",
  ".vscode",
  ".idea",
  "target",
  ".next",
  "dist",
  ".superpowers",
]);

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
  if (entry.isDirectory && (FILE_TREE_ALWAYS_SKIP.has(entry.name) || options.excludeFolders.includes(entry.name))) return false;
  if (options.showAllFiles) return true;
  return options.filter(entry.name, entry.isDirectory);
}
