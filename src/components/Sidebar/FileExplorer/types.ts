/** A node in the file explorer tree (file or folder). */
export interface FileNode {
  id: string; // Full path
  name: string; // Display name (without extension for .md files)
  isFolder: boolean;
  children?: FileNode[];
}

/** Raw directory entry returned by the Tauri filesystem command. */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
}
