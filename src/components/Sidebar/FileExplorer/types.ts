/** A node in the file explorer tree (file or folder). */
export interface FileNode {
  id: string; // Full path
  name: string; // Display name (without extension for .md files)
  isFolder: boolean;
  children?: FileNode[];
}

/**
 * Class applied to react-window's outer element — the file tree's ONE real
 * scroll container. Passed to `<Tree className>`, which react-arborist forwards
 * to the virtualized list's outer div.
 *
 * It exists because that element ships with neither a class nor a role, so the
 * only way to reach it was to guess. Two places guessed `[role="tree"]` and both
 * were wrong: that is a non-scrolling wrapper one level up, which made scroll
 * restore a silent no-op and left a `::-webkit-scrollbar` rule styling nothing.
 */
export const FILE_TREE_SCROLLER_CLASS = "file-explorer-scroller";

/** Raw directory entry returned by the Tauri filesystem command. */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
}

/**
 * One node of the one-call tree listing (`list_directory_tree`, #1357): a
 * `DirectoryEntry` plus its pruned children. `unreadable` marks a directory the
 * walker could not read (shown empty, logged); a pruned directory has `children:
 * []` and is not unreadable.
 */
export interface TreeEntry extends DirectoryEntry {
  unreadable?: boolean;
  children?: TreeEntry[];
}

/** The listing: the root's children and whether a walker bound was hit. */
export interface TreeListing {
  entries: TreeEntry[];
  truncated: boolean;
}
