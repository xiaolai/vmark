import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { createSnapshot } from "@/utils/historyUtils";
import { isWindowFocused } from "@/utils/windowFocus";

// Re-entry guards for file operations (prevents duplicate dialogs)
const isOpeningRef = { current: false };
const isSavingRef = { current: false };

async function saveToPath(
  windowLabel: string,
  path: string,
  content: string,
  saveType: "manual" | "auto" = "manual"
): Promise<boolean> {
  try {
    await writeTextFile(path, content);
    useDocumentStore.getState().setFilePath(windowLabel, path);
    useDocumentStore.getState().markSaved(windowLabel);

    // Add to recent files
    useRecentFilesStore.getState().addFile(path);

    // Create history snapshot if enabled
    const { general } = useSettingsStore.getState();
    if (general.historyEnabled) {
      try {
        await createSnapshot(path, content, saveType, {
          maxSnapshots: general.historyMaxSnapshots,
          maxAgeDays: general.historyMaxAgeDays,
        });
      } catch (historyError) {
        console.warn("[History] Failed to create snapshot:", historyError);
        // Don't fail the save operation if history fails
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to save file:", error);
    return false;
  }
}

export function useFileOperations() {
  const windowLabel = useWindowLabel();

  const handleOpen = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;
    // Prevent re-entry (duplicate open dialogs)
    if (isOpeningRef.current) return;
    isOpeningRef.current = true;

    try {
      const doc = useDocumentStore.getState().getDocument(windowLabel);
      if (doc?.isDirty) {
        const confirmed = await ask("You have unsaved changes. Discard them?", {
          title: "Unsaved Changes",
          kind: "warning",
        });
        if (!confirmed) return;
      }
      const path = await open({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (path) {
        const content = await readTextFile(path);
        useDocumentStore.getState().loadContent(windowLabel, content, path);
        useRecentFilesStore.getState().addFile(path);
      }
    } catch (error) {
      console.error("Failed to open file:", error);
    } finally {
      isOpeningRef.current = false;
    }
  }, [windowLabel]);

  const handleSave = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;
    // Prevent re-entry (duplicate save dialogs)
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      const doc = useDocumentStore.getState().getDocument(windowLabel);
      if (!doc) return;

      if (doc.filePath) {
        await saveToPath(windowLabel, doc.filePath, doc.content, "manual");
      } else {
        const path = await save({
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (path) {
          await saveToPath(windowLabel, path, doc.content, "manual");
        }
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [windowLabel]);

  const handleSaveAs = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;
    // Prevent re-entry (duplicate save dialogs) - shares guard with handleSave
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      const doc = useDocumentStore.getState().getDocument(windowLabel);
      if (!doc) return;

      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (path) {
        await saveToPath(windowLabel, path, doc.content, "manual");
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [windowLabel]);

  // menu:close now handled by useWindowClose hook via Rust window event

  // Handle opening file from FileExplorer
  const handleOpenFile = useCallback(
    async (event: { payload: { path: string } }) => {
      // Only respond if this window is focused
      if (!(await isWindowFocused())) return;

      const { path } = event.payload;
      const doc = useDocumentStore.getState().getDocument(windowLabel);

      if (doc?.isDirty) {
        const confirmed = await ask("You have unsaved changes. Discard them?", {
          title: "Unsaved Changes",
          kind: "warning",
        });
        if (!confirmed) return;
      }

      try {
        const content = await readTextFile(path);
        useDocumentStore.getState().loadContent(windowLabel, content, path);
        useRecentFilesStore.getState().addFile(path);
      } catch (error) {
        console.error("Failed to open file:", error);
      }
    },
    [windowLabel]
  );

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Note: menu:new is now handled directly in Rust (creates new window)

      const unlistenOpen = await listen("menu:open", handleOpen);
      if (cancelled) { unlistenOpen(); return; }
      unlistenRefs.current.push(unlistenOpen);

      const unlistenSave = await listen("menu:save", handleSave);
      if (cancelled) { unlistenSave(); return; }
      unlistenRefs.current.push(unlistenSave);

      const unlistenSaveAs = await listen("menu:save-as", handleSaveAs);
      if (cancelled) { unlistenSaveAs(); return; }
      unlistenRefs.current.push(unlistenSaveAs);

      // Listen for open-file from FileExplorer
      const unlistenOpenFile = await listen<{ path: string }>(
        "open-file",
        handleOpenFile
      );
      if (cancelled) { unlistenOpenFile(); return; }
      unlistenRefs.current.push(unlistenOpenFile);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, [handleOpen, handleSave, handleSaveAs, handleOpenFile]);
}
