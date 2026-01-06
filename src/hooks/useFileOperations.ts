import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { createSnapshot } from "@/utils/historyUtils";
import { isWindowFocused } from "@/utils/windowFocus";
import { getDefaultSaveFolder } from "@/utils/tabUtils";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";

async function saveToPath(
  tabId: string,
  path: string,
  content: string,
  saveType: "manual" | "auto" = "manual"
): Promise<boolean> {
  try {
    await writeTextFile(path, content);
    useDocumentStore.getState().setFilePath(tabId, path);
    useDocumentStore.getState().markSaved(tabId);
    // Update tab path for title sync
    useTabStore.getState().updateTabPath(tabId, path);

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

  const openPathInTab = useCallback(
    async (path: string, options?: { preferNewTab?: boolean; forceReuse?: boolean }) => {
      const preferNewTab = options?.preferNewTab ?? false;
      const forceReuse = options?.forceReuse ?? false;
      let tabId = useTabStore.getState().activeTabId[windowLabel];
      const activeDoc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;

      const shouldOpenInNewTab =
        preferNewTab || !tabId || (!forceReuse && activeDoc?.isDirty);
      if (shouldOpenInNewTab) {
        tabId = useTabStore.getState().createTab(windowLabel, path);
      }

      try {
        const content = await readTextFile(path);
        if (shouldOpenInNewTab && tabId) {
          useDocumentStore.getState().initDocument(tabId, content, path);
        } else if (tabId) {
          useDocumentStore.getState().loadContent(tabId, content, path);
          useTabStore.getState().updateTabPath(tabId, path);
        }
        useRecentFilesStore.getState().addFile(path);
      } catch (error) {
        console.error("Failed to open file:", error);
      }
    },
    [windowLabel]
  );

  const handleOpen = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;

    await withReentryGuard(windowLabel, "open", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
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
        try {
          const content = await readTextFile(path);
          useDocumentStore.getState().loadContent(tabId, content, path);
          useTabStore.getState().updateTabPath(tabId, path);
          useRecentFilesStore.getState().addFile(path);
        } catch (error) {
          console.error("Failed to open file:", error);
        }
      }
    });
  }, [windowLabel]);

  const handleSave = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;
    flushActiveWysiwygNow();

    await withReentryGuard(windowLabel, "save", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
      if (!doc) return;

      if (doc.filePath) {
        await saveToPath(tabId, doc.filePath, doc.content, "manual");
      } else {
        // Use folder from another saved file in this window as default
        const defaultFolder = getDefaultSaveFolder(windowLabel);
        const path = await save({
          defaultPath: defaultFolder,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (path) {
          await saveToPath(tabId, path, doc.content, "manual");
        }
      }
    });
  }, [windowLabel]);

  const handleSaveAs = useCallback(async () => {
    // Only respond if this window is focused
    if (!(await isWindowFocused())) return;
    flushActiveWysiwygNow();

    await withReentryGuard(windowLabel, "save", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
      if (!doc) return;

      // Use current file's folder or folder from another saved file
      const defaultFolder = doc.filePath
        ? doc.filePath.substring(0, doc.filePath.lastIndexOf("/"))
        : getDefaultSaveFolder(windowLabel);
      const path = await save({
        defaultPath: defaultFolder,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (path) {
        await saveToPath(tabId, path, doc.content, "manual");
      }
    });
  }, [windowLabel]);

  // menu:close now handled by useWindowClose hook via Rust window event

  // Handle opening file from FileExplorer
  const handleOpenFile = useCallback(
    async (event: { payload: { path: string } }) => {
      // Only respond if this window is focused
      if (!(await isWindowFocused())) return;

      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const { path } = event.payload;
      const doc = useDocumentStore.getState().getDocument(tabId);

      if (doc?.isDirty) {
        const confirmed = await ask("You have unsaved changes. Discard them?", {
          title: "Unsaved Changes",
          kind: "warning",
        });
        if (!confirmed) return;
      }

      await openPathInTab(path, { forceReuse: true });
    },
    [openPathInTab, windowLabel]
  );

  const handleAppOpenFile = useCallback(
    async (event: { payload: string }) => {
      await openPathInTab(event.payload);
    },
    [openPathInTab]
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

      const unlistenAppOpenFile = await listen<string>(
        "app:open-file",
        handleAppOpenFile
      );
      if (cancelled) { unlistenAppOpenFile(); return; }
      unlistenRefs.current.push(unlistenAppOpenFile);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, [handleOpen, handleSave, handleSaveAs, handleOpenFile, handleAppOpenFile]);
}
