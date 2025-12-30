import { useState, useEffect, useCallback, useRef } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import { join, basename } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FsChangeEvent } from "./types";

async function loadDirectoryRecursive(
  dirPath: string,
  filter: (name: string, isFolder: boolean) => boolean
): Promise<FileNode[]> {
  try {
    const entries = await readDir(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      const isFolder = entry.isDirectory;
      const name = entry.name;

      // Skip hidden files/folders
      if (name.startsWith(".")) continue;

      // Apply filter
      if (!filter(name, isFolder)) continue;

      const fullPath = await join(dirPath, name);

      if (isFolder) {
        const children = await loadDirectoryRecursive(fullPath, filter);
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
          name: name.replace(/\.md$/, ""),
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
  return name.endsWith(".md");
};

export function useFileTree(rootPath: string | null) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const loadTree = useCallback(async () => {
    if (!rootPath) {
      setTree([]);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const nodes = await loadDirectoryRecursive(rootPath, mdFilter);
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
  }, [rootPath]);

  // Load tree and setup watcher when rootPath changes
  useEffect(() => {
    if (!rootPath) {
      setTree([]);
      return;
    }

    loadTree();

    // Start file watcher
    invoke("start_watching", { path: rootPath }).catch((err) => {
      console.warn("[FileTree] Failed to start watcher:", err);
    });

    // Listen for fs changes
    let cancelled = false;
    listen<FsChangeEvent>("fs:changed", (event) => {
      if (cancelled) return;
      // Only refresh if the change is within our root
      if (event.payload.path.startsWith(rootPath)) {
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
      invoke("stop_watching").catch(() => {
        // Ignore errors on cleanup
      });
    };
  }, [rootPath, loadTree]);

  return { tree, isLoading, refresh: loadTree };
}

/**
 * Extract directory from file path
 */
export async function getDirectory(filePath: string): Promise<string> {
  const name = await basename(filePath);
  return filePath.slice(0, -name.length - 1); // Remove /filename
}
