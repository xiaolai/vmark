/**
 * FileExplorer
 *
 * Purpose: Workspace file tree panel using react-arborist for virtualized tree rendering.
 * Only available in workspace mode — shows the file types VMark can open (or every file,
 * via the header's showAllFiles toggle) with drag-and-drop, rename, delete, context menus.
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
 * @coordinates-with useExplorerActionWiring.ts — open-by-type, create flows, context-menu dispatch, tree handlers
 * @coordinates-with useExplorerContextMenu.ts — context-menu state, keyed to the workspace
 * @coordinates-with useFileExplorerOpenState.ts — persists folder open state across remounts
 * @coordinates-with Sidebar.tsx — parent component that provides the ref
 * @module components/Sidebar/FileExplorer/FileExplorer
 */
import { useRef, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Tree, type TreeApi } from "react-arborist";
import { useFileTree } from "./useFileTree";
import {
  useFileExplorerOpenState,
  useExplorerWorkspaceInstance,
  useRestoredScroll,
} from "./useFileExplorerOpenState";
import { FileExplorerEmptyState, FileExplorerWorkspaceHeader } from "./FileExplorerEmptyState";
import { ContextMenu } from "./ContextMenu";
import { useTreeWiring } from "./useTreeWiring";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import { getFileName } from "@/utils/paths";
import { fileExplorerError } from "@/utils/debug";
import { useQuickLookHotkey } from "./useQuickLookHotkey";
import { useExplorerContextMenu } from "./useExplorerContextMenu";
import { useExplorerActionWiring } from "./useExplorerActionWiring";
import type { FileNode as FileNodeType } from "./types";
import "./FileExplorer.css";

// Stable empty array reference to avoid re-renders
const EMPTY_FOLDERS: string[] = [];

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
  const excludeFolders = useWorkspaceStore((s) => s.config?.excludeFolders ?? EMPTY_FOLDERS);
  const showHiddenFiles = useWorkspaceStore((s) => s.config?.showHiddenFiles ?? false);
  const showAllFiles = useWorkspaceStore((s) => s.config?.showAllFiles ?? false);
  // Global, not workspace config: the same preference also drives tab titles.
  const showExtensions = useSettingsStore((s) => s.general.showFileExtensions ?? true);
  const windowLabel = useWindowLabel();

  const treeRef = useRef<TreeApi<FileNodeType> | null>(null);
  const handleQuickLookKeyDown = useQuickLookHotkey(treeRef);

  // Workspace-only: no inferred root from file path
  const rootPath = isWorkspaceMode ? workspaceRootPath : null;

  // WI-9.2: with the rail on, folder/scroll state is per workspace instance.
  const workspaceInstanceId = useExplorerWorkspaceInstance(windowLabel);
  // The context menu belongs to the workspace it was opened in (#323).
  const { contextMenu, handleContextMenu, closeContextMenu } = useExplorerContextMenu(
    `${workspaceInstanceId ?? ""}|${rootPath ?? ""}`,
    treeRef,
  );
  // Identity-stable Tree wiring — see useTreeWiring's header (#1187).
  const { setTreeContainer, renderNode, treeHeight, scrollerClassName, treeElRef } = useTreeWiring(currentFilePath);

  // Persisted folder open state — preserved across sidebar view-mode switches
  // (react-arborist unmounts on viewMode change, losing internal state otherwise).
  const { initialOpenState, handleToggle, collapseAll, expandAll, handleTreeScroll, restoreScroll } =
    useFileExplorerOpenState(treeRef, workspaceInstanceId);

  const { tree, isLoading, error, refresh } = useFileTree(rootPath, {
    excludeFolders,
    showHidden: showHiddenFiles,
    showAllFiles,
    showExtensions,
    watchId: windowLabel,
  });

  // WI-9.2: restore the incoming instance's saved scroll once tree data is in
  // — ONCE per instance, not on every watcher refresh (audit R2, #635; see the
  // hook's header for why "rows are in" is not the same as "not loading").
  useRestoredScroll(workspaceInstanceId, !isLoading && tree.length > 0, treeElRef, restoreScroll);
  // Every action the tree and the context menu dispatch — see the hook's header.
  const {
    handleNewFile,
    handleNewFolder,
    handleContextMenuAction,
    handleActivate,
    handleRename,
    handleDelete,
    handleMove,
  } = useExplorerActionWiring({ rootPath, treeRef, tree, refresh, contextMenu, showExtensions });

  // Expose methods to parent via ref. The two create flows are ASYNC and the
  // handle declares `void`, so their promise is discarded at every call site
  // (the Sidebar's header buttons) — a rejected create was an unhandled
  // rejection with nothing on screen (audit R3 #636). Caught and logged here,
  // the same shape the context-menu dispatch below already uses.
  useImperativeHandle(ref, () => ({
    createNewFile: () => {
      void Promise.resolve(handleNewFile()).catch((e) => fileExplorerError("New file failed:", e));
    },
    createNewFolder: () => {
      void Promise.resolve(handleNewFolder()).catch((e) => fileExplorerError("New folder failed:", e));
    },
    collapseAll,
    expandAll,
  }), [handleNewFile, handleNewFolder, collapseAll, expandAll]);

  // Extract workspace name from path
  const workspaceName = workspaceRootPath
    ? getFileName(workspaceRootPath) || t("workspaceFallback")
    : null;

  // Empty state: no workspace, first load, or an UNREADABLE root ("empty" lies).
  if (!rootPath) {
    return <FileExplorerEmptyState label={t("noWorkspace")} ariaLabel={t("aria.fileExplorer")} />;
  }
  if (error || (isLoading && tree.length === 0)) {
    return <FileExplorerEmptyState label={t(error ? "loadFailed" : "loading")} ariaLabel={t("aria.fileExplorer")} />;
  }

  return (
    <div className="file-explorer" role="navigation" aria-label={t("aria.fileExplorer")}>
      <FileExplorerWorkspaceHeader name={isWorkspaceMode ? workspaceName : null} />
      <div
        className="file-explorer-tree"
        ref={setTreeContainer}
        onContextMenu={handleContextMenu}
        onKeyDown={handleQuickLookKeyDown}
        // CAPTURE sees every descendant's scroll, and this persists the offset
        // to restore later: a scrolling rename input — or any nested scroller —
        // wrote ITS `scrollTop` (usually 0) over the tree's, so switching
        // workspaces restored the tree to the top (audit R3 #637). react-window's
        // outer div is the ONE scroller, and it is the one carrying this class.
        onScrollCapture={(e) => {
          const target = e.target;
          if (!(target instanceof HTMLElement) || !target.classList.contains(scrollerClassName)) return;
          handleTreeScroll(target.scrollTop);
        }}
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
          onAction={(action) => void Promise.resolve(handleContextMenuAction(action)).catch((e) => fileExplorerError("File explorer action failed:", e))}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
});
