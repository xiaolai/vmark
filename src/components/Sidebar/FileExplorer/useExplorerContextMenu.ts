/**
 * useExplorerContextMenu — the file explorer's context-menu state (audit
 * 20260907, #323).
 *
 * A right-click on a tree node opens the menu for that node's path and kind;
 * a right-click on empty space opens the workspace-level menu. The state is
 * keyed to the workspace it was opened in: when `workspaceKey` changes —
 * another root, or another rail instance — the menu closes during the
 * render, because an open menu carries the PREVIOUS workspace's absolute
 * path and every action on it (delete, rename, duplicate, move…) would land
 * there. A rail click dismisses the menu through its own outside-click
 * handler, but a keyboard shortcut or an MCP `workspace.open_folder` switches
 * workspaces without any pointer event the menu could see.
 *
 * @coordinates-with src/components/Sidebar/FileExplorer/FileExplorer.tsx — the consumer
 * @coordinates-with src/components/Sidebar/FileExplorer/ContextMenu.tsx — renders the state
 * @module components/Sidebar/FileExplorer/useExplorerContextMenu
 */
import { useCallback, useState, type MouseEvent, type RefObject } from "react";
import type { TreeApi } from "react-arborist";
import type { ContextMenuPosition, ContextMenuType } from "./ContextMenu";
import { FILE_NODE_ID_ATTR, FILE_NODE_ROW_CLASS, type FileNode } from "./types";

export interface ContextMenuState {
  visible: boolean;
  type: ContextMenuType;
  position: ContextMenuPosition;
  targetPath: string | null;
  targetIsFolder: boolean;
}

const CLOSED: ContextMenuState = {
  visible: false,
  type: "empty",
  position: { x: 0, y: 0 },
  targetPath: null,
  targetIsFolder: false,
};

export function useExplorerContextMenu(
  workspaceKey: string,
  treeRef: RefObject<TreeApi<FileNode> | null>,
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED);
  // "Adjust state when a prop changes", during render (React's own pattern,
  // #1063): the menu belongs to the workspace it was opened in.
  const [openedIn, setOpenedIn] = useState(workspaceKey);
  if (openedIn !== workspaceKey) {
    setOpenedIn(workspaceKey);
    setContextMenu(CLOSED);
  }

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const position = { x: e.clientX, y: e.clientY };
      setContextMenu(menuStateForEvent(e.target, position, treeRef.current));
    },
    [treeRef],
  );

  return { contextMenu, handleContextMenu, closeContextMenu };
}

/** The id of the tree ROW containing `target`, or null when it is empty space. */
export function rowIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`.${FILE_NODE_ROW_CLASS}`)?.getAttribute(FILE_NODE_ID_ATTR) ?? null;
}

/**
 * The menu state a right-click at `position` should produce (audit R3 #647):
 * that node's menu over a row, the workspace-level one over empty space, and
 * NO menu over a row the tree cannot resolve.
 *
 * That last case is not empty space. Falling through to the workspace menu put
 * "New File" and "New Folder" at the ROOT under a pointer sitting on a file
 * (audit R2, #649); no menu at all is the honest answer for a target that has
 * gone — mid refresh, or filtered out.
 *
 * Pure, so the hit-testing is checkable without a right-click: the hook mixed
 * it with the workspace synchronization above and neither could be read alone.
 */
export function menuStateForEvent(
  target: EventTarget | null,
  position: ContextMenuPosition,
  tree: TreeApi<FileNode> | null,
): ContextMenuState {
  const nodeId = rowIdAt(target);
  if (nodeId === null) return { ...CLOSED, visible: true, position };
  const node = tree?.get(nodeId);
  if (!node) return CLOSED;
  return {
    visible: true,
    type: node.data.isFolder ? "folder" : "file",
    position,
    targetPath: node.data.id,
    targetIsFolder: node.data.isFolder,
  };
}
