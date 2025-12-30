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

// Re-entry guards
const isCreatingRef = { current: false };
const isDeletingRef = { current: false };

export function useExplorerOperations() {
  const isRenamingRef = useRef(false);

  const createFile = useCallback(
    async (parentPath: string, name: string): Promise<string | null> => {
      if (isCreatingRef.current) return null;
      isCreatingRef.current = true;

      try {
        const fileName = name.endsWith(".md") ? name : `${name}.md`;
        const filePath = await join(parentPath, fileName);

        if (await exists(filePath)) {
          console.warn("[Explorer] File already exists:", filePath);
          return null;
        }

        await writeTextFile(filePath, "");
        return filePath;
      } catch (error) {
        console.error("[Explorer] Failed to create file:", error);
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
          console.warn("[Explorer] Folder already exists:", folderPath);
          return null;
        }

        await mkdir(folderPath);
        return folderPath;
      } catch (error) {
        console.error("[Explorer] Failed to create folder:", error);
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
          console.warn("[Explorer] Target already exists:", newPath);
          return null;
        }

        await rename(oldPath, newPath);
        return newPath;
      } catch (error) {
        console.error("[Explorer] Failed to rename:", error);
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
        const message = isFolder
          ? `Delete folder "${name}" and all its contents?`
          : `Delete "${name}"?`;

        const confirmed = await ask(message, {
          title: `Delete ${itemType}`,
          kind: "warning",
        });

        if (!confirmed) return false;

        await remove(path, { recursive: isFolder });
        return true;
      } catch (error) {
        console.error("[Explorer] Failed to delete:", error);
        return false;
      } finally {
        isDeletingRef.current = false;
      }
    },
    []
  );

  const moveItem = useCallback(
    async (srcPath: string, destFolder: string): Promise<string | null> => {
      try {
        const name = await basename(srcPath);
        const destPath = await join(destFolder, name);

        if (srcPath === destPath) return srcPath;

        if (await exists(destPath)) {
          console.warn("[Explorer] Target already exists:", destPath);
          return null;
        }

        // For files, use rename (more efficient)
        // For folders, rename also works on most systems
        await rename(srcPath, destPath);
        return destPath;
      } catch (error) {
        console.error("[Explorer] Failed to move:", error);
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
      try {
        const name = await basename(path);
        const parentPath = path.slice(0, -name.length - 1);
        const nameWithoutExt = name.replace(/\.md$/, "");

        // Find a unique name
        let counter = 1;
        let newName = `${nameWithoutExt} copy.md`;
        let newPath = await join(parentPath, newName);

        while (await exists(newPath)) {
          counter++;
          newName = `${nameWithoutExt} copy ${counter}.md`;
          newPath = await join(parentPath, newName);
        }

        // Copy content
        const content = await readTextFile(path);
        await writeTextFile(newPath, content);

        return newPath;
      } catch (error) {
        console.error("[Explorer] Failed to duplicate:", error);
        return null;
      }
    },
    []
  );

  const copyPath = useCallback(async (path: string): Promise<void> => {
    try {
      await writeText(path);
    } catch (error) {
      console.error("[Explorer] Failed to copy path:", error);
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
