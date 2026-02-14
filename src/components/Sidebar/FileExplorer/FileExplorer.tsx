/**
 * FileExplorer
 *
 * Purpose: Workspace file tree panel using react-arborist for virtualized tree rendering.
 * Only available in workspace mode — shows markdown files with drag-and-drop, rename,
 * delete, and context menu operations.
 *
 * User interactions:
 *   - Double-click or Enter to open a file in a tab
 *   - Right-click for context menu (file/folder/empty area variants)
 *   - Drag-and-drop to move files between folders
 *   - Inline rename on F2 or via context menu
 *
 * Key decisions:
 *   - Uses forwardRef + useImperativeHandle to expose createNewFile/createNewFolder
 *     to the Sidebar header buttons.
 *   - File tree is workspace-only — no inferred root from file path (single-file mode
 *     has no explorer).
 *   - Tree height is measured dynamically via ResizeObserver because react-arborist
 *     (react-window) requires an explicit numeric pixel height.
 *   - After create operations, a small timeout allows the tree to refresh before
 *     auto-entering edit mode on the new node.
 *
 * @coordinates-with useFileTree.ts — loads directory tree and watches for fs changes
 * @coordinates-with useExplorerOperations.ts — CRUD operations on files and folders
 * @coordinates-with Sidebar.tsx — parent component that provides the ref
 * @module components/Sidebar/FileExplorer/FileExplorer
 */
import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { Tree, type TreeApi } from "react-arborist";
import { Folder } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useFileTree } from "./useFileTree";
import { useExplorerOperations } from "./useExplorerOperations";
import { FileNode } from "./FileNode";
import { ContextMenu, type ContextMenuType, type ContextMenuPosition } from "./ContextMenu";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { getFileName, getParentDir } from "@/utils/paths";
import type { FileNode as FileNodeType } from "./types";
import "./FileExplorer.css";

// Stable empty array reference to avoid re-renders
const EMPTY_FOLDERS: string[] = [];

interface ContextMenuState {
  visible: boolean;
  type: ContextMenuType;
  position: ContextMenuPosition;
  targetPath: string | null;
  targetIsFolder: boolean;
}

export interface FileExplorerHandle {
  createNewFile: () => void;
  createNewFolder: () => void;
}

interface FileExplorerProps {
  currentFilePath: string | null;
}

export const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(
  function FileExplorer({ currentFilePath }, ref) {
  // Workspace-only: file tree only shows when in workspace mode
  const workspaceRootPath = useWorkspaceStore((s) => s.rootPath);
  const isWorkspaceMode = useWorkspaceStore((s) => s.isWorkspaceMode);
  const excludeFolders = useWorkspaceStore(
    (s) => s.config?.excludeFolders ?? EMPTY_FOLDERS
  );
  const showHiddenFiles = useWorkspaceStore(
    (s) => s.config?.showHiddenFiles ?? false
  );
  const windowLabel = useWindowLabel();

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    type: "empty",
    position: { x: 0, y: 0 },
    targetPath: null,
    targetIsFolder: false,
  });
  const treeRef = useRef<TreeApi<FileNodeType> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [treeHeight, setTreeHeight] = useState(400);

  // Callback ref: attaches ResizeObserver when the tree container mounts.
  // Unlike useEffect+useRef, this fires even when the element appears after
  // an early return (loading state) re-render.
  const treeContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height && height > 0) setTreeHeight(Math.floor(height));
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // Workspace-only: no inferred root from file path
  const rootPath = isWorkspaceMode ? workspaceRootPath : null;

  const { tree, isLoading, refresh } = useFileTree(rootPath, {
    excludeFolders,
    showHidden: showHiddenFiles,
    watchId: windowLabel,
  });
  const {
    createFile,
    createFolder,
    renameItem,
    deleteItem,
    moveItem,
    openFile,
    duplicateFile,
    copyPath,
    revealInFinder,
  } = useExplorerOperations();

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  // Handle context menu on tree area
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // Check if right-clicked on a tree item
      const target = e.target as HTMLElement;
      const nodeElement = target.closest(".file-node");

      if (nodeElement) {
        // Right-clicked on a node - get node data from tree
        const nodeId = nodeElement.getAttribute("data-node-id");
        if (nodeId) {
          const node = treeRef.current?.get(nodeId);
          if (node) {
            setContextMenu({
              visible: true,
              type: node.data.isFolder ? "folder" : "file",
              position: { x: e.clientX, y: e.clientY },
              targetPath: node.data.id,
              targetIsFolder: node.data.isFolder,
            });
            return;
          }
        }
      }

      // Right-clicked on empty area
      setContextMenu({
        visible: true,
        type: "empty",
        position: { x: e.clientX, y: e.clientY },
        targetPath: null,
        targetIsFolder: false,
      });
    },
    []
  );

  // Handle context menu actions
  const handleContextMenuAction = useCallback(
    async (action: string) => {
      const { targetPath, targetIsFolder } = contextMenu;

      switch (action) {
        case "open":
          if (targetPath && !targetIsFolder) {
            openFile(targetPath);
          }
          break;

        case "rename":
          if (targetPath) {
            const node = treeRef.current?.get(targetPath);
            node?.edit();
          }
          break;

        case "duplicate":
          if (targetPath && !targetIsFolder) {
            await duplicateFile(targetPath);
          }
          break;

        case "moveTo":
          if (targetPath && !targetIsFolder) {
            const currentFolder = getParentDir(targetPath);
            const destFolder = await openDialog({
              title: `Move "${getFileName(targetPath)}" to...`,
              directory: true,
              defaultPath: currentFolder ?? undefined,
            });
            if (destFolder) {
              await moveItem(targetPath, destFolder);
            }
          }
          break;

        case "delete":
          if (targetPath) {
            await deleteItem(targetPath, targetIsFolder);
          }
          break;

        case "copyPath":
          if (targetPath) {
            await copyPath(targetPath);
          }
          break;

        case "revealInFinder":
          if (targetPath) {
            await revealInFinder(targetPath);
          }
          break;

        case "newFile":
          await handleNewFile(targetPath);
          break;

        case "newFolder":
          await handleNewFolder(targetPath);
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleNewFile/handleNewFolder use getState() pattern
    [contextMenu, openFile, duplicateFile, moveItem, deleteItem, copyPath, revealInFinder]
  );

  // Handle file activation (double-click or Enter)
  const handleActivate = useCallback(
    (node: { data: FileNodeType }) => {
      if (!node.data.isFolder) {
        openFile(node.data.id);
      }
    },
    [openFile]
  );

  // Handle rename
  const handleRename = useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      await renameItem(id, name);
    },
    [renameItem]
  );

  // Handle delete
  const handleDelete = useCallback(
    async ({ ids }: { ids: string[] }) => {
      for (const id of ids) {
        const node = treeRef.current?.get(id);
        if (node) {
          await deleteItem(id, node.data.isFolder);
        }
      }
    },
    [deleteItem]
  );

  // Handle move (drag-and-drop)
  const handleMove = useCallback(
    async ({
      dragIds,
      parentId,
    }: {
      dragIds: string[];
      parentId: string | null;
    }) => {
      const destFolder = parentId || rootPath;
      if (!destFolder) return;

      for (const id of dragIds) {
        await moveItem(id, destFolder);
      }
    },
    [moveItem, rootPath]
  );

  // Create new file
  const handleNewFile = useCallback(
    async (parentPath?: string | null) => {
      if (!rootPath) return;

      // Use provided path, selected folder, or root
      let targetPath = parentPath;
      if (!targetPath) {
        const selected = treeRef.current?.selectedNodes[0];
        targetPath = selected?.data.isFolder ? selected.data.id : rootPath;
      }

      const path = await createFile(targetPath, "Untitled");
      if (path) {
        await refresh();
        setTimeout(() => {
          const node = treeRef.current?.get(path);
          node?.edit();
        }, 100);
      }
    },
    [rootPath, createFile, refresh]
  );

  // Create new folder
  const handleNewFolder = useCallback(
    async (parentPath?: string | null) => {
      if (!rootPath) return;

      let targetPath = parentPath;
      if (!targetPath) {
        const selected = treeRef.current?.selectedNodes[0];
        targetPath = selected?.data.isFolder ? selected.data.id : rootPath;
      }

      const path = await createFolder(targetPath, "New Folder");
      if (path) {
        await refresh();
        setTimeout(() => {
          const node = treeRef.current?.get(path);
          node?.edit();
        }, 100);
      }
    },
    [rootPath, createFolder, refresh]
  );

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    createNewFile: () => handleNewFile(),
    createNewFolder: () => handleNewFolder(),
  }), [handleNewFile, handleNewFolder]);

  // Extract workspace name from path
  const workspaceName = workspaceRootPath
    ? getFileName(workspaceRootPath) || "Workspace"
    : null;

  // Show empty state if no workspace is open
  if (!rootPath) {
    return (
      <div className="file-explorer">
        <div className="file-explorer-empty">
          No workspace open
        </div>
      </div>
    );
  }

  if (isLoading && tree.length === 0) {
    return (
      <div className="file-explorer">
        <div className="file-explorer-empty">Loading...</div>
      </div>
    );
  }

  return (
    <div className="file-explorer" ref={containerRef}>
      {/* Workspace header when in workspace mode */}
      {isWorkspaceMode && workspaceName && (
        <div className="file-explorer-workspace-header">
          <Folder size={14} />
          <span className="file-explorer-workspace-name">{workspaceName}</span>
        </div>
      )}
      <div className="file-explorer-tree" ref={treeContainerRef} onContextMenu={handleContextMenu}>
        <Tree<FileNodeType>
          ref={treeRef}
          data={tree}
          openByDefault={true}
          width="100%"
          height={treeHeight}
          indent={16}
          rowHeight={26}
          onActivate={handleActivate}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMove}
          disableDrag={false}
          disableDrop={false}
          disableEdit={false}
        >
          {(props) => (
            <FileNode {...props} currentFilePath={currentFilePath} />
          )}
        </Tree>
      </div>

      {contextMenu.visible && (
        <ContextMenu
          type={contextMenu.type}
          position={contextMenu.position}
          onAction={handleContextMenuAction}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
});
