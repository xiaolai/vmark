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
