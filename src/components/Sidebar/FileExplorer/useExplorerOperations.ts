/**
 * useExplorerOperations
 *
 * Purpose: File system CRUD for the explorer — create, rename, delete, move, duplicate, copy path, reveal.
 *
 * Key decisions:
 *   - Re-entry guards (isCreatingRef, isDeletingRef, isRenamingRef) prevent duplicate
 *     operations from rapid clicks or double-invocation.
 *   - Path reconciliation after rename/move/delete updates any open tabs pointing to
 *     the affected paths, so editors don't go stale.
 *   - Rename delegates to the shared services/persistence/renameFile core so the
 *     explorer and the tab context menu share identical rename semantics.
 *   - Delete uses a native confirmation dialog (Tauri ask) with parent folder context
 *     to help disambiguate similarly-named files.
 *
 * @coordinates-with FileExplorer.tsx — consumer of all exported operations
 * @coordinates-with services/persistence/renameFile.ts — shared rename core
 * @coordinates-with utils/pathReconciliation.ts — updates open tabs after path changes
 * @module components/Sidebar/FileExplorer/useExplorerOperations
 */
import { useCallback, useRef } from "react";
import {
  writeTextFile,
  copyFile,
  mkdir,
  rename,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { join, basename, dirname } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useTabStore } from "@/stores/tabStore";
import { reconcilePathChange } from "@/utils/pathReconciliation";
import { applyPathReconciliation } from "@/services/persistence/applyPathReconciliation";
import { showError, FileErrors } from "@/services/dialogs/errorDialog";
import { emitOpenFileInCurrentWindow } from "@/services/navigation/openFileEvent";
import { fileExplorerError } from "@/utils/debug";
import { fileExtensionOf, renameFile, type RenameOptions } from "@/services/persistence/renameFile";
import { captureExplorerNewFile } from "@/services/coherence/captureFunnel";
import { confirmAction } from "@/services/dialogs/confirmAction";

const isCreatingRef = { current: false }; // re-entry guards
const isDeletingRef = { current: false };

/** Hook providing file system CRUD operations (create, rename, delete, move, duplicate) for the file explorer. */
export function useExplorerOperations() {
  const isRenamingRef = useRef(false);

  const createFile = useCallback(
    async (parentPath: string, name: string): Promise<string | null> => {
      if (isCreatingRef.current) return null;
      isCreatingRef.current = true;

      const fileName = name.endsWith(".md") ? name : `${name}.md`;
      try {
        const filePath = await join(parentPath, fileName);

        if (await exists(filePath)) {
          await showError(FileErrors.fileExists(fileName));
          return null;
        }

        await writeTextFile(filePath, "");
        captureExplorerNewFile(filePath); // coherence WI-1.6
        return filePath;
      } catch (error) {
        fileExplorerError(" Failed to create file:", error);
        await showError(FileErrors.createFailed(fileName));
        return null;
      } finally {
        isCreatingRef.current = false;
      }
    },
    []
  );

  const createFolder = useCallback(
    async (parentPath: string, name: string): Promise<string | null> => {
      if (isCreatingRef.current) return null;
      isCreatingRef.current = true;

      try {
        const folderPath = await join(parentPath, name);

        if (await exists(folderPath)) {
          await showError(FileErrors.folderExists(name));
          return null;
        }

        await mkdir(folderPath);
        return folderPath;
      } catch (error) {
        fileExplorerError(" Failed to create folder:", error);
        await showError(FileErrors.createFailed(name));
        return null;
      } finally {
        isCreatingRef.current = false;
      }
    },
    []
  );

  const renameItem = useCallback(
    async (oldPath: string, newName: string, options?: RenameOptions): Promise<string | null> => {
      if (isRenamingRef.current) return null;
      isRenamingRef.current = true;

      try {
        // Shared rename core (preserves the original extension + reconciles open tabs).
        const outcome = await renameFile(oldPath, newName, options);
        switch (outcome.status) {
          case "renamed":
            return outcome.newPath;
          case "unchanged":
            return outcome.path;
          case "exists":
            await showError(
              outcome.isFile
                ? FileErrors.fileExists(outcome.name)
                : FileErrors.folderExists(outcome.name)
            );
            return null;
          case "error":
            fileExplorerError(" Failed to rename:", outcome.error);
            await showError(FileErrors.renameFailed(newName));
            return null;
        }
      } finally {
        isRenamingRef.current = false;
      }
    },
    []
  );

  const deleteItem = useCallback(
    async (path: string, isFolder: boolean): Promise<boolean> => {
      if (isDeletingRef.current) return false;
      isDeletingRef.current = true;

      try {
        const name = await basename(path);
        // Show parent folder for context when there could be ambiguity
        const parentPath = path.slice(0, -name.length - 1);
        const parentName = await basename(parentPath);
        const locationHint = parentName
          ? `\n\n${i18n.t("dialog:deleteItem.location", { parent: parentName })}`
          : "";
        const kindKey = isFolder ? "deleteFolder" : "deleteFile";
        const confirmed = await confirmAction({
          title: i18n.t(`dialog:${kindKey}.title`),
          message: `${i18n.t(`dialog:${kindKey}.message`, { name })}${locationHint}`,
          actionLabel: isFolder ? i18n.t("dialog:action.deleteFolder") : i18n.t("dialog:action.delete"),
          kind: "warning",
        });

        if (!confirmed) return false;

        // Get open file paths before delete
        const openFilePaths = useTabStore.getState().getAllOpenFilePaths();

        await remove(path, { recursive: isFolder });

        // Reconcile: mark any open tabs/documents as missing
        const results = reconcilePathChange({
          changeType: "delete",
          oldPath: path,
          openFilePaths,
        });
        applyPathReconciliation(results);

        return true;
      } catch (error) {
        fileExplorerError(" Failed to delete:", error);
        const name = await basename(path);
        await showError(FileErrors.deleteFailed(name));
        return false;
      } finally {
        isDeletingRef.current = false;
      }
    },
    []
  );

  const moveItem = useCallback(
    async (srcPath: string, destFolder: string): Promise<string | null> => {
      const name = await basename(srcPath);
      try {
        const destPath = await join(destFolder, name);

        if (srcPath === destPath) return srcPath;

        if (await exists(destPath)) {
          const isFile = name.includes(".");
          await showError(
            isFile
              ? FileErrors.fileExists(name)
              : FileErrors.folderExists(name)
          );
          return null;
        }

        // Get open file paths before move
        const openFilePaths = useTabStore.getState().getAllOpenFilePaths();

        // For files, use rename (more efficient)
        // For folders, rename also works on most systems
        await rename(srcPath, destPath);

        // Reconcile: update any open tabs/documents pointing to old path
        const results = reconcilePathChange({
          changeType: "move",
          oldPath: srcPath,
          newPath: destPath,
          openFilePaths,
        });
        applyPathReconciliation(results);

        return destPath;
      } catch (error) {
        fileExplorerError(" Failed to move:", error);
        await showError(FileErrors.moveFailed(name));
        return null;
      }
    },
    []
  );

  const openFile = useCallback(async (path: string): Promise<void> => {
    await emitOpenFileInCurrentWindow(path);
  }, []);

  const openWithDefaultApp = useCallback(async (path: string): Promise<void> => {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(path);
    } catch (error) {
      fileExplorerError(" Failed to open with default app:", error);
      const name = await basename(path);
      toast.error(i18n.t("dialog:toast.failedToOpenWithDefaultApp", { name }));
    }
  }, []);

  const duplicateFile = useCallback(
    async (path: string): Promise<string | null> => {
      const name = await basename(path);
      try {
        const parentPath = await dirname(path); // not slicing — root-safe
        // Preserve the real extension: "notes.txt" → "notes copy.txt".
        const ext = fileExtensionOf(name);
        const base = ext ? name.slice(0, -ext.length) : name;
        // Find a unique name (with reasonable upper bound to prevent infinite loops)
        const MAX_COPIES = 1000;
        let counter = 1;
        let newName = `${base} copy${ext}`;
        let newPath = await join(parentPath, newName);

        while (await exists(newPath)) {
          counter++;
          if (counter > MAX_COPIES) {
            fileExplorerError(" Too many copies exist, cannot duplicate:", path);
            await showError(FileErrors.tooManyCopies(name));
            return null;
          }
          newName = `${base} copy ${counter}${ext}`;
          newPath = await join(parentPath, newName);
        }

        // Binary-safe copy — media must not round-trip through UTF-8 text.
        await copyFile(path, newPath);

        return newPath;
      } catch (error) {
        fileExplorerError(" Failed to duplicate:", error);
        await showError(FileErrors.duplicateFailed(name));
        return null;
      }
    },
    []
  );

  const copyPath = useCallback(async (path: string): Promise<void> => {
    try {
      await writeText(path);
      toast.success(i18n.t("dialog:toast.pathCopiedExplorer"));
    } catch (error) {
      fileExplorerError(" Failed to copy path:", error);
      await showError(FileErrors.copyFailed);
    }
  }, []);

  const revealInFinder = useCallback(async (path: string): Promise<void> => {
    try {
      await revealItemInDir(path);
    } catch (error) {
      fileExplorerError(" Failed to reveal in Finder:", error);
      toast.error(i18n.t("dialog:toast.revealInFinderFailed"));
    }
  }, []);

  return {
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
  };
}
