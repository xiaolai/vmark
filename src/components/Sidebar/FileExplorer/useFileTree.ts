import { useState, useEffect, useCallback, useRef } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import { join, basename } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FsChangeEvent } from "./types";
import { shouldRefreshTree } from "@/utils/fsEventFilter";
import { isMarkdownFileName, stripMarkdownExtension } from "@/utils/dropPaths";

interface LoadOptions {
  filter: (name: string, isFolder: boolean) => boolean;
  excludeFolders: string[];
}

async function loadDirectoryRecursive(
  dirPath: string,
  options: LoadOptions
): Promise<FileNode[]> {
  try {
    const entries = await readDir(dirPath);
    const nodes: FileNode[] = [];
    const { filter, excludeFolders } = options;

    for (const entry of entries) {
      const isFolder = entry.isDirectory;
      const name = entry.name;

      // Skip hidden files/folders
      if (name.startsWith(".")) continue;

      // Skip excluded folders (from workspace config)
      if (isFolder && excludeFolders.includes(name)) continue;

      // Apply filter
      if (!filter(name, isFolder)) continue;

      const fullPath = await join(dirPath, name);

      if (isFolder) {
        const children = await loadDirectoryRecursive(fullPath, options);
        // Only include folders that have matching children
        if (children.length > 0) {
          nodes.push({
            id: fullPath,
            name,
            isFolder: true,
            children,
          });
        }
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
  /** Window label used as watchId for scoped file system events */
  watchId?: string;
}

export function useFileTree(
  rootPath: string | null,
  options: UseFileTreeOptions = {}
) {
  const { excludeFolders = [], watchId = "main" } = options;
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
  }, [rootPath, excludeFoldersKey]);

  // Load tree and setup watcher when rootPath changes
  useEffect(() => {
    if (!rootPath) {
      setTree([]);
      return;
    }

    loadTree();

    // Start file watcher with watchId for scoping
    invoke("start_watching", { watchId, path: rootPath }).catch((err) => {
      console.warn("[FileTree] Failed to start watcher:", err);
    });

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
      invoke("stop_watching", { watchId }).catch(() => {
        // Ignore errors on cleanup
      });
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
