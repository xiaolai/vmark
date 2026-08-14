/**
 * useExplorerCreateFlow
 *
 * Purpose: the create → refresh → inline-rename sequence for the file explorer,
 * extracted from FileExplorer.tsx where it was three interleaved pieces of
 * state and two effects.
 *
 * Key decisions:
 *   - **The workspace root is captured before the await.** Creating a file is
 *     async; switching workspaces during it left the completion holding a
 *     `refresh` bound to the OLD root, which would then load the old tree into
 *     the new workspace's state. The generation check makes a create that
 *     outlives its workspace a no-op instead.
 *   - **One create at a time, across the WHOLE cycle.** The re-entry guard in
 *     useExplorerOperations covers only the filesystem call, so a second
 *     create starting while the first awaited its refresh overwrote the single
 *     pending-edit slot and the first file never entered rename mode.
 *   - Rename starts when the node actually EXISTS in the tree, not after a
 *     fixed timer: too short on a slow watcher meant rename silently never
 *     opened, and the timer could still fire after unmount.
 *
 * @coordinates-with FileExplorer.tsx — sole caller
 * @coordinates-with useExplorerOperations.ts — supplies the create functions
 * @module components/Sidebar/FileExplorer/useExplorerCreateFlow
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TreeApi } from "react-arborist";
import type { FileNode } from "./types";
import { fileExplorerError } from "@/utils/debug";

interface CreateFlowOptions {
  rootPath: string | null;
  refresh: () => Promise<void>;
  treeRef: React.RefObject<TreeApi<FileNode> | null>;
  /** Tree data — the effect re-checks for the new node whenever it changes. */
  tree: FileNode[];
}

/** Creates an entry and puts it into inline rename once it appears in the tree. */
export function useExplorerCreateFlow({ rootPath, refresh, treeRef, tree }: CreateFlowOptions) {
  const [pendingEditPath, setPendingEditPath] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  // The LIVE root. Comparing against the `rootPath` in scope would compare the
  // captured value with itself — an in-flight call holds the closure it started
  // in, so the check has to read something that moves.
  const currentRootRef = useRef(rootPath);
  useEffect(() => {
    currentRootRef.current = rootPath;
  }, [rootPath]);

  const createEntryAndEdit = useCallback(
    async (
      create: (parent: string, name: string) => Promise<string | null>,
      defaultName: string,
      parentPath?: string | null,
    ) => {
      if (!rootPath || inFlightRef.current) return;
      inFlightRef.current = true;
      // The workspace this create belongs to. Anything that comes back after
      // the user has moved on belongs to a tree that is no longer on screen.
      const createdUnder = rootPath;
      try {
        let targetPath = parentPath;
        if (!targetPath) {
          const selected = treeRef.current?.selectedNodes[0];
          targetPath = selected?.data.isFolder ? selected.data.id : rootPath;
        }
        const path = await create(targetPath, defaultName);
        if (!path || createdUnder !== currentRootRef.current) return;
        setPendingEditPath(path);
        await refresh();
      } finally {
        inFlightRef.current = false;
      }
    },
    [rootPath, refresh, treeRef],
  );

  // A pending path only counts while its workspace is the one on screen. This
  // is derived, not stored: a workspace switch abandons the rename by making
  // the value stop matching, rather than by an effect racing to clear it.
  const pendingForCurrentRoot =
    pendingEditPath && rootPath && pendingEditPath.startsWith(rootPath)
      ? pendingEditPath
      : null;

  // Start the inline rename once the created node is really in the tree.
  useEffect(() => {
    if (!pendingForCurrentRoot) return;
    const node = treeRef.current?.get(pendingForCurrentRoot);
    if (!node) return;
    setPendingEditPath(null);
    void Promise.resolve(node.edit()).catch((e) => fileExplorerError("Failed to start inline rename:", e));
  }, [pendingForCurrentRoot, tree, treeRef]);

  return { createEntryAndEdit };
}
