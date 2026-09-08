/**
 * useExplorerActionWiring — the file explorer's action callbacks (audit
 * 20260907, #322).
 *
 * Purpose: everything FileExplorer wires from the tree and the context menu
 * into operations — opening by file type, the create-then-rename flows, the
 * context-menu action dispatch, and react-arborist's activate / rename /
 * delete / move handlers — lives here, so the component is layout and
 * subscriptions. The id → operation mapping itself stays in
 * contextMenuActions.ts; this file only supplies its dependencies.
 *
 * @coordinates-with FileExplorer.tsx — the consumer
 * @coordinates-with useExplorerOperations.ts — CRUD operations on files and folders
 * @coordinates-with useExplorerCreateFlow.ts — create → refresh → inline rename
 * @coordinates-with contextMenuActions.ts — owns the id → operation mapping
 * @module components/Sidebar/FileExplorer/useExplorerActionWiring
 */
import { useCallback, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { TreeApi } from "react-arborist";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useExplorerOperations } from "./useExplorerOperations";
import { useExplorerCreateFlow } from "./useExplorerCreateFlow";
import { runContextMenuAction } from "./contextMenuActions";
import type { ContextMenuActionId } from "./ContextMenu";
import type { ContextMenuState } from "./useExplorerContextMenu";
import type { FileNode as FileNodeType } from "./types";
import { getFileName, getParentDir, isWithinRoot } from "@/utils/paths";
import { isSupportedFileName, isVMarkFileName } from "@/utils/dropPaths";
import { openTerminalHere } from "@/services/terminal/openTerminalHere";
import { imeToast as toast } from "@/services/ime/imeToast";
import { fileExplorerError } from "@/utils/debug";
import i18n from "@/i18n";

/**
 * The dragged paths with every DESCENDANT of another dragged path removed.
 *
 * A multi-selection that holds a folder and something inside it arrives as
 * both, and a folder moves its contents with it. Whichever order the two are
 * moved in is wrong: parent first leaves the child's old path gone and the
 * second move fails with an error dialog, child first lifts the child OUT of
 * the folder the user dragged as one thing. Only the top-level paths are real
 * move operations (audit R2, #645).
 */
export function topLevelPaths(ids: readonly string[]): string[] {
  return ids.filter((id) => !ids.some((other) => other !== id && isWithinRoot(other, id)));
}

/**
 * Ask for one folder, defaulting to `near`'s own parent when it has one.
 *
 * The result is NARROWED, not asserted. `open()` answers
 * `string | string[] | null` — the array is what `multiple: true` returns — and
 * the `as Promise<string | null>` this replaces silenced that union rather than
 * handling it, so a future option (or a plugin change) that produced an array
 * would have been passed on as a path and used to build one (audit R3 #640).
 *
 * `defaultPath` is OMITTED, not undefined: `getParentDir` answers "" for a path
 * at the filesystem root, and the `?? undefined` that preceded it was dead code
 * — the helper returns `string`, never nullish — so the panel was handed an
 * empty defaultPath (audit R2, #639). `exactOptionalPropertyTypes` is why the
 * key is spread away rather than set to undefined.
 */
async function pickFolder(title: string, near: string): Promise<string | null> {
  const parent = getParentDir(near);
  const picked = await openDialog({
    title,
    directory: true,
    ...(parent === "" ? {} : { defaultPath: parent }),
  });
  return typeof picked === "string" ? picked : null;
}

export interface ExplorerActionWiringInput {
  rootPath: string | null;
  treeRef: RefObject<TreeApi<FileNodeType> | null>;
  tree: FileNodeType[];
  refresh: () => Promise<void>;
  contextMenu: Pick<ContextMenuState, "targetPath" | "targetIsFolder">;
  /** Whether names show their extension — a rename keeps it otherwise. */
  showExtensions: boolean;
}

export function useExplorerActionWiring({
  rootPath,
  treeRef,
  tree,
  refresh,
  contextMenu,
  showExtensions,
}: ExplorerActionWiringInput) {
  const { t } = useTranslation("sidebar");
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

  // Create → refresh → inline rename, with its workspace-generation and
  // one-at-a-time guards (see the hook's header).
  const { createEntryAndEdit } = useExplorerCreateFlow({ rootPath, refresh, treeRef, tree });

  // Shared: open supported files in VMark, others with system default app.
  // Async on BOTH branches — the supported one used to drop the promise from
  // `openFile`, whose emitter propagates rejection, so a failed open surfaced
  // as an unhandled rejection instead of a message.
  const openFileByType = useCallback(
    async (path: string): Promise<void> => {
      const fileName = getFileName(path);
      // Phase 1B: any registered format opens in VMark; `isVMarkFileName`
      // (markdown or yaml) covers the pre-bootstrap edge before the registry
      // knows its formats — the workflow viewer has no switch since D6.
      const isSupported = fileName && (isSupportedFileName(fileName) || isVMarkFileName(fileName));
      if (isSupported) {
        try {
          await openFile(path);
        } catch (error) {
          fileExplorerError(" Failed to open file:", path, error);
          toast.error(i18n.t("dialog:toast.failedToOpen", { filename: fileName }));
        }
      } else {
        await openWithDefaultApp(path);
      }
    },
    [openFile, openWithDefaultApp]
  );

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

  // Context-menu actions — the id → operation mapping lives in
  // contextMenuActions.ts; this only supplies what each operation needs.
  const handleContextMenuAction = useCallback(
    (action: ContextMenuActionId) =>
      runContextMenuAction(action, {
        targetPath: contextMenu.targetPath,
        targetIsFolder: contextMenu.targetIsFolder,
        openFileByType: (path: string) => void Promise.resolve(openFileByType(path)).catch((e) => fileExplorerError("Failed to open file:", e)),
        editNode: (path) => void Promise.resolve(treeRef.current?.get(path)?.edit()).catch((e) => fileExplorerError("Inline rename failed:", e)),
        duplicateFile,
        pickMoveDestination: (path) => pickFolder(t("contextMenu.moveToTitle", { name: getFileName(path) }), path),
        moveItem,
        deleteItem,
        copyPath,
        revealInFinder,
        newFile: handleNewFile,
        newFolder: handleNewFolder,
        openTerminalHere,
        notifyError: (key) => toast.error(i18n.t(key)),
      }),
    [contextMenu, openFileByType, duplicateFile, moveItem, deleteItem, copyPath, revealInFinder, handleNewFile, handleNewFolder, t, treeRef]
  );

  // File activation (single click or Enter on a file row).
  //
  // react-arborist does not await this, so the promise ends here: the
  // system-app branch of `openFileByType` has no try/catch of its own, and a
  // refused `openWithDefaultApp` surfaced as an unhandled rejection (audit R2,
  // #641). Same boundary treatment as the context-menu route above.
  const handleActivate = useCallback(
    (node: { data: FileNodeType }) => {
      if (!node.data.isFolder) {
        void openFileByType(node.data.id).catch((e: unknown) =>
          fileExplorerError("Failed to open file:", node.data.id, e),
        );
      }
    },
    [openFileByType]
  );

  const handleRename = useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      await renameItem(id, name, { preserveExtension: !showExtensions });
    },
    [renameItem, showExtensions]
  );

  // Each item is confirmed separately (the dialog names it), so the batch STOPS
  // at the first `false`: that is either the user cancelling or a failure that
  // has already shown its own error. Running on regardless asked again for
  // every remaining selection and deleted the ones that were confirmed after
  // the user had already said no — a partial batch nobody asked for (audit R2,
  // #642).
  //
  // The handler's own `nodes` are the selection SNAPSHOT react-arborist took
  // when the user pressed Delete. Re-resolving each id from the live tree
  // instead meant every await in the loop — a confirm dialog, a filesystem
  // call, a refresh — could drop the rows still to come, and a node the tree
  // no longer held was skipped in silence (audit R2, #643).
  const handleDelete = useCallback(
    async ({ nodes }: { nodes: readonly { data: FileNodeType }[] }) => {
      for (const { data } of nodes) {
        if (!(await deleteItem(data.id, data.isFolder))) return;
      }
    },
    [deleteItem]
  );

  // Drag-and-drop: a drop on empty space lands in the workspace root.
  //
  // react-arborist calls `onMove` without awaiting it, so nothing upstream
  // serializes two quick drops or catches a rejection from one — an unhandled
  // rejection, and two overlapping filesystem moves reconciling open tabs
  // against each other's snapshots. The guard refuses re-entry while a move is
  // running and the boundary keeps a failure inside the handler (audit R2,
  // #644). Descendants of a dragged folder are dropped first: they travel WITH
  // their parent, so moving them separately either relocates a child out of
  // the folder it is inside or fails on a source path that no longer exists
  // (audit R2, #645).
  const movingRef = useRef(false);
  const handleMove = useCallback(
    async ({ dragIds, parentId }: { dragIds: string[]; parentId: string | null }) => {
      const destFolder = parentId || rootPath;
      if (!destFolder || movingRef.current) return;
      movingRef.current = true;
      try {
        for (const id of topLevelPaths(dragIds)) {
          await moveItem(id, destFolder);
        }
      } catch (error) {
        fileExplorerError("Failed to move:", error);
      } finally {
        movingRef.current = false;
      }
    },
    [moveItem, rootPath]
  );

  // `openFileByType` is deliberately NOT returned: it is this hook's own policy,
  // reached through `handleActivate` and the context menu's Open, and no
  // consumer read it (audit R3 #646). A public surface with no caller is one
  // more thing a future change has to keep working.
  return {
    handleNewFile,
    handleNewFolder,
    handleContextMenuAction,
    handleActivate,
    handleRename,
    handleDelete,
    handleMove,
  };
}
