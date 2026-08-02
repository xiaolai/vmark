/**
 * FileExplorer
 *
 * Purpose: Workspace file tree panel using react-arborist for virtualized tree rendering.
 * Only available in workspace mode — shows markdown files (and optionally all files via
 * showAllFiles config) with drag-and-drop, rename, delete, and context menu operations.
 * Non-markdown files open with the system default app.
 * User-visible strings are translated via the "sidebar" i18n namespace.
 *
 * User interactions:
 *   - Single click opens a file in a tab (react-arborist activates on click;
 *     Enter starts inline rename instead, since onRename is wired)
 *   - Right-click for context menu (file/folder/empty area variants)
 *   - Drag-and-drop to move files between folders
 *   - Inline rename on F2 or via context menu
 *
 * Key decisions:
 *   - Uses forwardRef + useImperativeHandle to expose createNewFile / createNewFolder /
 *     collapseAll / expandAll to the Sidebar header buttons.
 *   - File tree is workspace-only — no inferred root from file path (single-file mode
 *     has no explorer).
 *   - Tree height is measured dynamically via ResizeObserver (react-window needs an
 *     explicit pixel height) and is the CONTENT box; react-window's outer div
 *     (`scrollerClassName`) is the ONE scroller. See useObservedHeight.ts.
 *   - After create operations, a small timeout allows the tree to refresh before
 *     auto-entering edit mode on the new node.
 *   - Folders default to collapsed (openByDefault=false). Open/closed state is persisted
 *     across Files ↔ Outline ↔ History view switches via useFileExplorerOpenState, which
 *     snapshots uiStore at mount and mirrors toggles back.
 *   - Root element is a `navigation` ARIA landmark (labelled `aria.fileExplorer`).
 *
 * @coordinates-with useTreeWiring.tsx — identity-stable Tree children/ref, measured height, scroller class
 * @coordinates-with useFileTree.ts — loads directory tree and watches for fs changes
 * @coordinates-with useExplorerOperations.ts — CRUD operations on files and folders
 * @coordinates-with useFileExplorerOpenState.ts — persists folder open state across remounts
 * @coordinates-with Sidebar.tsx — parent component that provides the ref
 * @coordinates-with contextMenuActions.ts — owns the id → operation mapping
 * @module components/Sidebar/FileExplorer/FileExplorer
 */
import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Tree, type TreeApi } from "react-arborist";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useFileTree } from "./useFileTree";
import { useExplorerOperations } from "./useExplorerOperations";
import { useFileExplorerOpenState, useExplorerWorkspaceInstance } from "./useFileExplorerOpenState";
import { FileExplorerEmptyState, FileExplorerWorkspaceHeader } from "./FileExplorerEmptyState";
import {
  ContextMenu,
  type ContextMenuType,
  type ContextMenuPosition,
  type ContextMenuActionId,
} from "./ContextMenu";
import { useTreeWiring } from "./useTreeWiring";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { getFileName, getParentDir } from "@/utils/paths";
import { isMarkdownFileName, isSupportedFileName, isVMarkFileName } from "@/utils/dropPaths";
import { isWorkflowEnabled } from "@/services/featureFlags/workflowFeatureFlag";
import { runContextMenuAction } from "./contextMenuActions";
import { openTerminalHere } from "@/services/terminal/openTerminalHere";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useQuickLookHotkey } from "./useQuickLookHotkey";
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

/** Imperative handle exposed by FileExplorer for programmatic file/folder creation and tree expansion. */
export interface FileExplorerHandle {
  createNewFile: () => void;
  createNewFolder: () => void;
  collapseAll: () => void;
  expandAll: () => void;
}

interface FileExplorerProps {
  currentFilePath: string | null;
}

/** Workspace file tree panel with virtualized rendering, drag-and-drop, and context menu support. */
export const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(
  function FileExplorer({ currentFilePath }, ref) {
  const { t } = useTranslation("sidebar");
  // Workspace-only: file tree only shows when in workspace mode
  const workspaceRootPath = useWorkspaceStore((s) => s.rootPath);
  const isWorkspaceMode = useWorkspaceStore((s) => s.isWorkspaceMode);
  const excludeFolders = useWorkspaceStore(
    (s) => s.config?.excludeFolders ?? EMPTY_FOLDERS
  );
  const showHiddenFiles = useWorkspaceStore(
    (s) => s.config?.showHiddenFiles ?? false
  );
  const showAllFiles = useWorkspaceStore(
    (s) => s.config?.showAllFiles ?? false
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
  const handleQuickLookKeyDown = useQuickLookHotkey(treeRef);

  // Workspace-only: no inferred root from file path
  const rootPath = isWorkspaceMode ? workspaceRootPath : null;

  // WI-9.2: with the rail on, folder/scroll state is per workspace instance.
  const workspaceInstanceId = useExplorerWorkspaceInstance(windowLabel);
  // Identity-stable Tree wiring — see useTreeWiring's header (#1187).
  const { setTreeContainer, renderNode, treeHeight, scrollerClassName, treeElRef } = useTreeWiring(currentFilePath);

  // Persisted folder open state — preserved across sidebar view-mode switches
  // (react-arborist unmounts on viewMode change, losing internal state otherwise).
  const { initialOpenState, handleToggle, collapseAll, expandAll, handleTreeScroll, restoreScroll } =
    useFileExplorerOpenState(treeRef, workspaceInstanceId);

  // Path of a just-created entry awaiting inline rename; see createEntryAndEdit.
  const [pendingEditPath, setPendingEditPath] = useState<string | null>(null);

  const { tree, isLoading, refresh } = useFileTree(rootPath, {
    excludeFolders,
    showHidden: showHiddenFiles,
    showAllFiles,
    watchId: windowLabel,
  });

  // WI-9.2: restore the incoming instance's saved scroll once tree data is in.
  useEffect(() => { if (!isLoading) restoreScroll(treeElRef.current); },
    [workspaceInstanceId, isLoading, restoreScroll]);
  const {
    createFile,
    createFolder,
    renameItem,
    deleteItem,
    moveItem,
    openFile,
    openWithDefaultApp,
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

  // Shared: open supported files in VMark, others with system default app
  const openFileByType = useCallback(
    (path: string) => {
      const fileName = getFileName(path);
      // Phase 1B: any registered format opens in VMark. The workflow-
      // engine / markdown-only fallback covers the pre-bootstrap edge.
      const isSupported =
        fileName &&
        (isSupportedFileName(fileName) ||
          (isWorkflowEnabled()
            ? isVMarkFileName(fileName)
            : isMarkdownFileName(fileName)));
      if (isSupported) {
        openFile(path);
      } else {
        void openWithDefaultApp(path);
      }
    },
    [openFile, openWithDefaultApp]
  );

  // Create a new file/folder under `parentPath` (or the selected folder / root),
  // then put it into rename mode once the tree has refreshed.
  const createEntryAndEdit = useCallback(
    async (
      create: (parent: string, name: string) => Promise<string | null>,
      defaultName: string,
      parentPath?: string | null,
    ) => {
      if (!rootPath) return;
      let targetPath = parentPath;
      if (!targetPath) {
        const selected = treeRef.current?.selectedNodes[0];
        targetPath = selected?.data.isFolder ? selected.data.id : rootPath;
      }
      const path = await create(targetPath, defaultName);
      if (!path) return;
      // Record what to edit, then let the effect below start the rename as
      // soon as the node actually exists. A fixed timer used to guess when
      // that would be: too short on a slow watcher (rename mode silently never
      // opened) and still able to fire after unmount or a workspace switch.
      setPendingEditPath(path);
      await refresh();
    },
    [rootPath, refresh],
  );

  // Start inline rename once the created node is really in the tree (audit).
  useEffect(() => {
    if (!pendingEditPath) return;
    const node = treeRef.current?.get(pendingEditPath);
    if (!node) return;
    setPendingEditPath(null);
    node.edit();
  }, [pendingEditPath, tree]);

  // A workspace switch abandons any pending rename — the path belongs to the
  // tree we just left.
  useEffect(() => {
    setPendingEditPath(null);
  }, [rootPath]);

  const handleNewFile = useCallback(
    (parentPath?: string | null) =>
      createEntryAndEdit(createFile, t("defaultFileName"), parentPath),
    [createEntryAndEdit, createFile, t],
  );

  const handleNewFolder = useCallback(
    (parentPath?: string | null) =>
      createEntryAndEdit(createFolder, t("defaultFolderName"), parentPath),
    [createEntryAndEdit, createFolder, t],
  );

  // Handle context menu actions — the id → operation mapping lives in
  // contextMenuActions.ts so this file stays layout + wiring.
  const handleContextMenuAction = useCallback(
    (action: ContextMenuActionId) =>
      runContextMenuAction(action, {
        targetPath: contextMenu.targetPath,
        targetIsFolder: contextMenu.targetIsFolder,
        openFileByType,
        editNode: (path) => treeRef.current?.get(path)?.edit(),
        duplicateFile,
        pickMoveDestination: (path) =>
          openDialog({
            title: t("contextMenu.moveToTitle", { name: getFileName(path) }),
            directory: true,
            defaultPath: getParentDir(path) ?? undefined,
          }) as Promise<string | null>,
        moveItem,
        deleteItem,
        copyPath,
        revealInFinder,
        newFile: handleNewFile,
        newFolder: handleNewFolder,
        openTerminalHere,
        notifyError: (key) => toast.error(i18n.t(key)),
      }),
    [contextMenu, openFileByType, duplicateFile, moveItem, deleteItem, copyPath, revealInFinder, handleNewFile, handleNewFolder, t]
  );

  // Handle file activation (double-click or Enter)
  const handleActivate = useCallback(
    (node: { data: FileNodeType }) => {
      if (!node.data.isFolder) {
        openFileByType(node.data.id);
      }
    },
    [openFileByType]
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

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    createNewFile: () => handleNewFile(),
    createNewFolder: () => handleNewFolder(),
    collapseAll,
    expandAll,
  }), [handleNewFile, handleNewFolder, collapseAll, expandAll]);

  // Extract workspace name from path
  const workspaceName = workspaceRootPath
    ? getFileName(workspaceRootPath) || t("workspaceFallback")
    : null;

  // Show empty state if no workspace is open (or while the tree first loads).
  if (!rootPath) {
    return <FileExplorerEmptyState label={t("noWorkspace")} ariaLabel={t("aria.fileExplorer")} />;
  }
  if (isLoading && tree.length === 0) {
    return <FileExplorerEmptyState label={t("loading")} ariaLabel={t("aria.fileExplorer")} />;
  }

  return (
    <div className="file-explorer" role="navigation" aria-label={t("aria.fileExplorer")}>
      <FileExplorerWorkspaceHeader name={isWorkspaceMode ? workspaceName : null} />
      <div
        className="file-explorer-tree"
        ref={setTreeContainer}
        onContextMenu={handleContextMenu}
        onKeyDown={handleQuickLookKeyDown}
        onScrollCapture={(e) => handleTreeScroll((e.target as HTMLElement).scrollTop)}
      >
        <Tree<FileNodeType>
          key={workspaceInstanceId ?? "window"}
          ref={treeRef}
          className={scrollerClassName}
          data={tree}
          openByDefault={false}
          initialOpenState={initialOpenState}
          width="100%"
          height={treeHeight}
          indent={16}
          rowHeight={26}
          onActivate={handleActivate}
          onToggle={handleToggle}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMove}
          disableDrag={false}
          disableDrop={false}
          disableEdit={false}
        >
          {renderNode}
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
