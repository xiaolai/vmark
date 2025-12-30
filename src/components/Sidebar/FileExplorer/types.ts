export interface FileNode {
  id: string; // Full path
  name: string; // Display name (without extension for .md files)
  isFolder: boolean;
  children?: FileNode[];
}

export interface FsChangeEvent {
  path: string;
  kind: "create" | "modify" | "remove" | "rename";
}
