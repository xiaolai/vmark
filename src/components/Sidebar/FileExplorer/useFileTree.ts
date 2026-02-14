/**
 * useFileTree
 *
 * Purpose: Loads and maintains a recursive file tree for a workspace directory.
 * Listens for file system change events to auto-refresh the tree when files are
 * created, renamed, or deleted.
 *
 * Key decisions:
 *   - Only includes markdown files (via mdFilter) — other file types are hidden
 *     to keep the explorer focused on editable content.
 *   - Request ID pattern (requestIdRef) prevents stale async responses from
 *     overwriting fresher tree data.
 *   - Watch events are scoped by watchId (window label) to prevent cross-window
 *     interference when multiple windows watch the same directory.
 *   - Folders are always included (even if empty) so users can right-click to
 *     add files into them.
 *
 * @coordinates-with FileExplorer.tsx — consumes the tree data and refresh callback
 * @coordinates-with utils/fsEventFilter.ts — determines if an fs event should trigger refresh
 * @module components/Sidebar/FileExplorer/useFileTree
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { basename } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FsChangeEvent, DirectoryEntry } from "./types";
import { shouldRefreshTree } from "@/utils/fsEventFilter";
import { isMarkdownFileName, stripMarkdownExtension } from "@/utils/dropPaths";
import { shouldIncludeEntry, type FileTreeFilterOptions } from "./fileTreeFilters";

type LoadOptions = FileTreeFilterOptions;

async function listDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
  try {
    return await invoke<DirectoryEntry[]>("list_directory_entries", { path: dirPath });
  } catch (error) {
    console.error("[FileTree] Failed to read directory:", dirPath, error);
    return [];
  }
}

async function loadDirectoryRecursive(
  dirPath: string,
  options: LoadOptions
): Promise<FileNode[]> {
  try {
    const entries = await listDirectoryEntries(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (!shouldIncludeEntry(entry, options)) continue;
      const isFolder = entry.isDirectory;
      const name = entry.name;
      const fullPath = entry.path;

      if (isFolder) {
        const children = await loadDirectoryRecursive(fullPath, options);
        // Always include folders so users can right-click to add files
        nodes.push({
          id: fullPath,
          name,
          isFolder: true,
          children,
        });
      } else {
        nodes.push({
          id: fullPath,
          name: stripMarkdownExtension(name),
          isFolder: false,
        });
      }
    }

    // Sort: folders first, then alphabetically
    return nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error("[FileTree] Failed to load directory:", dirPath, error);
    return [];
  }
}

const mdFilter = (name: string, isFolder: boolean): boolean => {
  if (isFolder) return true;
  return isMarkdownFileName(name);
};

interface UseFileTreeOptions {
  excludeFolders?: string[];
  showHidden?: boolean;
  /** Window label used as watchId for scoped file system events */
  watchId?: string;
}

export function useFileTree(
  rootPath: string | null,
  options: UseFileTreeOptions = {}
) {
  const { excludeFolders = [], showHidden = false, watchId = "main" } = options;
  const [tree, setTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  // Serialize excludeFolders for dependency comparison
  const excludeFoldersKey = excludeFolders.join(",");

  const loadTree = useCallback(async () => {
    if (!rootPath) {
      setTree([]);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const loadOptions: LoadOptions = {
        filter: mdFilter,
        excludeFolders,
        showHidden,
      };
      const nodes = await loadDirectoryRecursive(rootPath, loadOptions);
      if (currentRequestId === requestIdRef.current) {
        setTree(nodes);
      }
    } catch (error) {
      console.error("[FileTree] Failed to load tree:", error);
      if (currentRequestId === requestIdRef.current) {
        setTree([]);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludeFoldersKey is stable serialization
  }, [rootPath, excludeFoldersKey, showHidden]);

  // Load tree and setup watcher when rootPath changes
  useEffect(() => {
    if (!rootPath) {
      setTree([]);
      return;
    }

    loadTree();

    // Listen for fs changes
    let cancelled = false;
    listen<FsChangeEvent>("fs:changed", (event) => {
      if (cancelled) return;
      // Use pure helper to determine if we should refresh
      if (shouldRefreshTree(event.payload, watchId, rootPath)) {
        loadTree();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [rootPath, loadTree, watchId]);

  return { tree, isLoading, refresh: loadTree };
}

/**
 * Extract directory from file path
 */
export async function getDirectory(filePath: string): Promise<string> {
  const name = await basename(filePath);
  return filePath.slice(0, -name.length - 1); // Remove /filename
}
