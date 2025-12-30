import { useState, useEffect, useCallback, useRef } from "react";
import { Tree, type TreeApi } from "react-arborist";
import { FilePlus, FolderPlus } from "lucide-react";
import { useFileTree, getDirectory } from "./useFileTree";
import { useExplorerOperations } from "./useExplorerOperations";
import { FileNode } from "./FileNode";
import { ContextMenu, type ContextMenuType, type ContextMenuPosition } from "./ContextMenu";
import type { FileNode as FileNodeType } from "./types";
import "./FileExplorer.css";

interface ContextMenuState {
  visible: boolean;
  type: ContextMenuType;
  position: ContextMenuPosition;
  targetPath: string | null;
  targetIsFolder: boolean;
}

interface FileExplorerProps {
  currentFilePath: string | null;
}

export function FileExplorer({ currentFilePath }: FileExplorerProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    type: "empty",
    position: { x: 0, y: 0 },
    targetPath: null,
    targetIsFolder: false,
  });
  const treeRef = useRef<TreeApi<FileNodeType> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { tree, isLoading, refresh } = useFileTree(rootPath);
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

  // Update root path only when opening a file outside current workspace
  // This keeps the explorer stable when clicking files within the tree
  useEffect(() => {
    if (!currentFilePath) {
      setRootPath(null);
      return;
    }

    // If we have a root and the new file is within it, don't change root
    if (rootPath && currentFilePath.startsWith(rootPath + "/")) {
      return; // File is within current workspace, keep root stable
    }

    // New file is outside current workspace (or no workspace yet) - update root
    getDirectory(currentFilePath).then(setRootPath);
  }, [currentFilePath, rootPath]);

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
    [contextMenu, openFile, duplicateFile, deleteItem, copyPath, revealInFinder]
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

  if (!currentFilePath) {
    return (
      <div className="file-explorer">
        <div className="file-explorer-empty">
          Save document to browse files
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
      <div className="file-explorer-toolbar">
        <button
          className="file-explorer-btn"
          onClick={() => handleNewFile()}
          title="New File"
        >
          <FilePlus size={14} />
        </button>
        <button
          className="file-explorer-btn"
          onClick={() => handleNewFolder()}
          title="New Folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="file-explorer-tree" onContextMenu={handleContextMenu}>
        <Tree<FileNodeType>
          ref={treeRef}
          data={tree}
          openByDefault={true}
          width="100%"
          height={400}
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
}
