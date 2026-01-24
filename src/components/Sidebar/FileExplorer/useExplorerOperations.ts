import { useCallback, useRef } from "react";
import {
  writeTextFile,
  readTextFile,
  mkdir,
  rename,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { ask } from "@tauri-apps/plugin-dialog";
import { join, basename } from "@tauri-apps/api/path";
import { emit } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useTabStore } from "@/stores/tabStore";
import { reconcilePathChange } from "@/utils/pathReconciliation";
import { applyPathReconciliation } from "@/hooks/commands";
import { showError, FileErrors } from "@/utils/errorDialog";

// Re-entry guards
const isCreatingRef = { current: false };
const isDeletingRef = { current: false };

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
        return filePath;
      } catch (error) {
        console.error("[Explorer] Failed to create file:", error);
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
        console.error("[Explorer] Failed to create folder:", error);
        await showError(FileErrors.createFailed(name));
        return null;
      } finally {
        isCreatingRef.current = false;
      }
    },
    []
  );

  const renameItem = useCallback(
    async (oldPath: string, newName: string): Promise<string | null> => {
      if (isRenamingRef.current) return null;
      isRenamingRef.current = true;

      try {
        const oldName = await basename(oldPath);
        const parentPath = oldPath.slice(0, -oldName.length - 1);

        // Preserve .md extension for files
        const isFile = !oldPath.endsWith("/") && oldName.includes(".");
        const finalName = isFile && !newName.endsWith(".md")
          ? `${newName}.md`
          : newName;

        const newPath = await join(parentPath, finalName);

        if (oldPath === newPath) return oldPath;

        if (await exists(newPath)) {
          const isTargetFile = finalName.includes(".");
          await showError(
            isTargetFile
              ? FileErrors.fileExists(finalName)
              : FileErrors.folderExists(finalName)
          );
          return null;
        }

        // Get open file paths before rename
        const openFilePaths = useTabStore.getState().getAllOpenFilePaths();

        await rename(oldPath, newPath);

        // Reconcile: update any open tabs/documents pointing to old path
        const results = reconcilePathChange({
          changeType: "rename",
          oldPath,
          newPath,
          openFilePaths,
        });
        applyPathReconciliation(results);

        return newPath;
      } catch (error) {
        console.error("[Explorer] Failed to rename:", error);
        await showError(FileErrors.renameFailed(newName));
        return null;
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
        const itemType = isFolder ? "folder" : "file";
        // Show parent folder for context when there could be ambiguity
        const parentPath = path.slice(0, -name.length - 1);
        const parentName = await basename(parentPath);
        const locationHint = parentName ? `\n\nLocation: ${parentName}/` : "";
        const message = isFolder
          ? `Delete folder "${name}" and all its contents?${locationHint}`
          : `Delete "${name}"?${locationHint}`;

        const confirmed = await ask(message, {
          title: `Delete ${itemType}`,
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
        console.error("[Explorer] Failed to delete:", error);
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
        console.error("[Explorer] Failed to move:", error);
        await showError(FileErrors.moveFailed(name));
        return null;
      }
    },
    []
  );

  const openFile = useCallback(async (path: string): Promise<void> => {
    await emit("open-file", { path });
  }, []);

  const duplicateFile = useCallback(
    async (path: string): Promise<string | null> => {
      const name = await basename(path);
      try {
        const parentPath = path.slice(0, -name.length - 1);
        const nameWithoutExt = name.replace(/\.md$/, "");

        // Find a unique name (with reasonable upper bound to prevent infinite loops)
        const MAX_COPIES = 1000;
        let counter = 1;
        let newName = `${nameWithoutExt} copy.md`;
        let newPath = await join(parentPath, newName);

        while (await exists(newPath)) {
          counter++;
          if (counter > MAX_COPIES) {
            console.error("[Explorer] Too many copies exist, cannot duplicate:", path);
            await showError(FileErrors.tooManyCopies(name));
            return null;
          }
          newName = `${nameWithoutExt} copy ${counter}.md`;
          newPath = await join(parentPath, newName);
        }

        // Copy content
        const content = await readTextFile(path);
        await writeTextFile(newPath, content);

        return newPath;
      } catch (error) {
        console.error("[Explorer] Failed to duplicate:", error);
        await showError(FileErrors.duplicateFailed(name));
        return null;
      }
    },
    []
  );

  const copyPath = useCallback(async (path: string): Promise<void> => {
    try {
      await writeText(path);
      toast.success("Path copied to clipboard");
    } catch (error) {
      console.error("[Explorer] Failed to copy path:", error);
      await showError(FileErrors.copyFailed);
    }
  }, []);

  const revealInFinder = useCallback(async (path: string): Promise<void> => {
    try {
      await revealItemInDir(path);
    } catch (error) {
      console.error("[Explorer] Failed to reveal in Finder:", error);
    }
  }, []);

  return {
    createFile,
    createFolder,
    renameItem,
    deleteItem,
    moveItem,
    openFile,
    duplicateFile,
    copyPath,
    revealInFinder,
  };
}
