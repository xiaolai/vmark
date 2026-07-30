/**
 * useFileExplorerOpenState
 *
 * Purpose: Persist FileExplorer folder open/closed state across sidebar view-mode
 * switches (Files ↔ Outline ↔ History), which unmount/remount the tree — and,
 * with a `workspaceInstanceId` (WI-9.2), per WORKSPACE INSTANCE so folder state
 * and scroll offset switch with the workspace rail. Snapshots the backing map at
 * mount, mirrors single toggles back, and coalesces bulk collapse/expand into a
 * single store write.
 *
 * Key decisions:
 *   - initialOpenState is captured once at mount: react-arborist reads this prop
 *     only during its internal store creation, so reactive subscription would be
 *     wasted renders. FileExplorer remounts the Tree with key=instanceId, so a
 *     rail switch re-runs the snapshot for the incoming instance.
 *   - Backing store: `workspaceInstanceUiStore` when an instance id is given
 *     (rail on), `uiStore`'s window-global map otherwise — rail-off behavior is
 *     byte-identical to the pre-rail hook.
 *   - A fresh instance (no saved map) seeds from the window-global map so the
 *     first activation keeps the user's current view instead of collapsing all.
 *   - During openAll/closeAll, arborist fires onToggle per folder. We suspend
 *     mirroring via bulkOpRef and do a single write at the end.
 *   - Arborist's synthetic root uses id `__REACT_ARBORIST_INTERNAL_ROOT__`. Its
 *     close() fires onToggle but its isOpen() is hardcoded true, which would
 *     pollute our path-keyed map with a non-path key. Filtered in every path.
 *   - Scroll capture is DOM-based (container capture phase), not arborist-API
 *     based, so it survives arborist internals changing; writes are trailing-
 *     throttled to one per SCROLL_THROTTLE_MS.
 *
 * @coordinates-with FileExplorer.tsx — owns the treeRef and passes handlers to Tree
 * @coordinates-with uiStore.ts — window-global fileExplorerOpenState (rail off)
 * @coordinates-with stores/workspaceInstanceUiStore.ts — per-instance state (rail on)
 * @module components/Sidebar/FileExplorer/useFileExplorerOpenState
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { TreeApi } from "react-arborist";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectActiveWorkspaceInstance,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import type { FileNode as FileNodeType } from "./types";

/**
 * The workspace instance whose file-tree state the explorer should show:
 * the window's active rail instance when the rail is on, else null
 * (window-global state, byte-identical to pre-rail behavior).
 */
export function useExplorerWorkspaceInstance(windowLabel: string): string | null {
  const railEnabled = useSettingsStore((s) => s.general.workspaceRailMode);
  const activeInstance = useWorkspaceInstancesStore((s) =>
    selectActiveWorkspaceInstance(s, windowLabel),
  );
  return railEnabled ? (activeInstance?.workspaceInstanceId ?? null) : null;
}

/** Arborist's synthetic root node id — not a workspace path; must never be persisted. */
const ARBORIST_ROOT_ID = "__REACT_ARBORIST_INTERNAL_ROOT__";

const SCROLL_THROTTLE_MS = 150;

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
  /** Wire to the tree container's scroll (capture phase); throttled persist. */
  handleTreeScroll: (scrollTop: number) => void;
  /** Restore the instance's saved scroll offset onto the tree's scroller. */
  restoreScroll: (container: HTMLElement | null) => void;
}

/**
 * Hook factory that owns FileExplorer open-state persistence and bulk operations.
 * Exported for unit testing with a mock TreeApi.
 */
export function useFileExplorerOpenState(
  treeRef: RefObject<TreeApi<FileNodeType> | null>,
  workspaceInstanceId: string | null = null,
): FileExplorerOpenStateApi {
  // react-arborist reads initialOpenState exactly once during its store
  // creation, so a non-reactive snapshot is correct here. The Tree remounts
  // (key=instanceId) when the rail switches, re-running this for the incoming
  // instance. A fresh instance seeds from the window-global map (continuity).
  const initialOpenState = useMemo(() => {
    if (workspaceInstanceId) {
      const saved = useWorkspaceInstanceUiStore
        .getState()
        .getInstanceUiState(workspaceInstanceId).fileExplorerOpenState;
      if (saved) return saved;
    }
    return useUIStore.getState().fileExplorerOpenState;
  }, [workspaceInstanceId]);

  const bulkOpRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef<number | null>(null);

  const writeOpenState = useCallback(
    (openState: Record<string, boolean>) => {
      if (workspaceInstanceId) {
        useWorkspaceInstanceUiStore
          .getState()
          .updateInstanceUiState(workspaceInstanceId, { fileExplorerOpenState: openState });
      } else {
        useUIStore.getState().setFileExplorerOpenState(openState);
      }
    },
    [workspaceInstanceId],
  );

  const handleToggle = useCallback((id: string) => {
    if (bulkOpRef.current) return;
    if (id === ARBORIST_ROOT_ID) return;
    const tree = treeRef.current;
    // Without a tree, we cannot read the truth; writing a guess would clobber
    // persisted state. Truly no-op in this (shouldn't-happen) path.
    if (!tree) return;
    if (workspaceInstanceId) {
      const current =
        useWorkspaceInstanceUiStore.getState().getInstanceUiState(workspaceInstanceId)
          .fileExplorerOpenState ?? {};
      writeOpenState({ ...current, [id]: tree.isOpen(id) });
    } else {
      useUIStore.getState().setFileExplorerNodeOpen(id, tree.isOpen(id));
    }
  }, [treeRef, workspaceInstanceId, writeOpenState]);

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
    writeOpenState(stripRoot(tree.openState ?? {}));
  }, [treeRef, writeOpenState]);

  const collapseAll = useCallback(() => runBulk("close"), [runBulk]);
  const expandAll = useCallback(() => runBulk("open"), [runBulk]);

  const handleTreeScroll = useCallback(
    (scrollTop: number) => {
      if (!workspaceInstanceId) return;
      pendingScrollRef.current = scrollTop;
      if (scrollTimerRef.current) return;
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        const offset = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (offset === null) return;
        useWorkspaceInstanceUiStore
          .getState()
          .updateInstanceUiState(workspaceInstanceId, { fileTreeScrollOffset: offset });
      }, SCROLL_THROTTLE_MS);
    },
    [workspaceInstanceId],
  );

  // Flush nothing on unmount, but never leave a timer running.
  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  const restoreScroll = useCallback(
    (container: HTMLElement | null) => {
      if (!container || !workspaceInstanceId) return;
      const offset = useWorkspaceInstanceUiStore
        .getState()
        .getInstanceUiState(workspaceInstanceId).fileTreeScrollOffset;
      if (offset === null || !Number.isFinite(offset)) return;
      // Arborist marks its virtualized scroller with role="tree".
      const scroller = container.querySelector<HTMLElement>('[role="tree"]');
      if (!scroller) return;
      scroller.scrollTop = offset;
    },
    [workspaceInstanceId],
  );

  return {
    initialOpenState,
    handleToggle,
    collapseAll,
    expandAll,
    handleTreeScroll,
    restoreScroll,
  };
}

/** @internal exported for testing */
export const __ARBORIST_ROOT_ID = ARBORIST_ROOT_ID;
