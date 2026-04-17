/**
 * useFileExplorerOpenState
 *
 * Purpose: Persist FileExplorer folder open/closed state across sidebar view-mode
 * switches (Files ↔ Outline ↔ History), which unmount/remount the tree. Snapshots
 * the uiStore map at mount, mirrors single toggles back, and coalesces bulk
 * collapse/expand into a single store write.
 *
 * Key decisions:
 *   - initialOpenState is captured once at mount: react-arborist reads this prop
 *     only during its internal store creation, so reactive subscription would be
 *     wasted renders.
 *   - During openAll/closeAll, arborist fires onToggle per folder. We suspend
 *     mirroring via bulkOpRef and do a single setFileExplorerOpenState at the end
 *     — avoids O(n²) map cloning on large trees.
 *   - Arborist's synthetic root uses id `__REACT_ARBORIST_INTERNAL_ROOT__`. Its
 *     close() fires onToggle but its isOpen() is hardcoded true, which would
 *     pollute our path-keyed map with a non-path key. Filtered in every path.
 *
 * @coordinates-with FileExplorer.tsx — owns the treeRef and passes handlers to Tree
 * @coordinates-with uiStore.ts — reads/writes fileExplorerOpenState
 * @module components/Sidebar/FileExplorer/useFileExplorerOpenState
 */
import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { TreeApi } from "react-arborist";
import { useUIStore } from "@/stores/uiStore";
import type { FileNode as FileNodeType } from "./types";

/** Arborist's synthetic root node id — not a workspace path; must never be persisted. */
const ARBORIST_ROOT_ID = "__REACT_ARBORIST_INTERNAL_ROOT__";

/** Strip the synthetic root from an open-state map so the store stays path-keyed. */
function stripRoot(openState: Record<string, boolean>): Record<string, boolean> {
  if (!(ARBORIST_ROOT_ID in openState)) return openState;
  const { [ARBORIST_ROOT_ID]: _root, ...rest } = openState;
  return rest;
}

export interface FileExplorerOpenStateApi {
  /** Snapshot passed once to Tree.initialOpenState at mount. */
  initialOpenState: Record<string, boolean>;
  /** Wire to Tree.onToggle — mirrors individual folder toggles into the store. */
  handleToggle: (id: string) => void;
  /** Close every folder and persist the new state in one store write. */
  collapseAll: () => void;
  /** Open every folder and persist the new state in one store write. */
  expandAll: () => void;
}

/**
 * Hook factory that owns FileExplorer open-state persistence and bulk operations.
 * Exported for unit testing with a mock TreeApi.
 */
export function useFileExplorerOpenState(
  treeRef: RefObject<TreeApi<FileNodeType> | null>,
): FileExplorerOpenStateApi {
  // react-arborist reads initialOpenState exactly once during its store creation,
  // so a non-reactive snapshot is correct here.
  const initialOpenState = useMemo(() => useUIStore.getState().fileExplorerOpenState, []);

  const bulkOpRef = useRef(false);

  const handleToggle = useCallback((id: string) => {
    if (bulkOpRef.current) return;
    if (id === ARBORIST_ROOT_ID) return;
    const tree = treeRef.current;
    // Without a tree, we cannot read the truth; writing a guess would clobber
    // persisted state. Truly no-op in this (shouldn't-happen) path.
    if (!tree) return;
    useUIStore.getState().setFileExplorerNodeOpen(id, tree.isOpen(id));
  }, [treeRef]);

  const runBulk = useCallback((op: "open" | "close") => {
    const tree = treeRef.current;
    if (!tree) return;
    bulkOpRef.current = true;
    try {
      if (op === "open") tree.openAll();
      else tree.closeAll();
    } finally {
      bulkOpRef.current = false;
    }
    useUIStore.getState().setFileExplorerOpenState(stripRoot(tree.openState ?? {}));
  }, [treeRef]);

  const collapseAll = useCallback(() => runBulk("close"), [runBulk]);
  const expandAll = useCallback(() => runBulk("open"), [runBulk]);

  return { initialOpenState, handleToggle, collapseAll, expandAll };
}

/** @internal exported for testing */
export const __ARBORIST_ROOT_ID = ARBORIST_ROOT_ID;
