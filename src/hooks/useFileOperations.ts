import { useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, remove } from "@tauri-apps/plugin-fs";
import { perfReset, perfStart, perfEnd, perfMark } from "@/utils/perfLog";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { saveToPath } from "@/utils/saveToPath";
import {
  resolveOpenAction,
  resolvePostSaveWorkspaceAction,
  resolveMissingFileSaveAction,
} from "@/utils/openPolicy";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { createUntitledTab } from "@/utils/newFile";
import { joinPath } from "@/utils/pathUtils";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { isWithinRoot, getParentDir } from "@/utils/paths";
import { saveAllDocuments, type CloseSaveContext } from "@/hooks/closeSave";

/**
 * Move a tab to a new workspace window if the file is outside current workspace.
 * Closes the current tab (or window if it's the last tab).
 * @internal Exported for testing
 */
export async function moveTabToNewWorkspaceWindow(
  windowLabel: string,
  tabId: string,
  filePath: string
): Promise<void> {
  const workspaceRoot = useWorkspaceStore.getState().rootPath;

  // If no workspace or file is within workspace, nothing to do
  if (!workspaceRoot || isWithinRoot(workspaceRoot, filePath)) return;

  const windowTabs = useTabStore.getState().tabs[windowLabel] || [];
  const isLastTab = windowTabs.length === 1;

  // Open in new window - derive workspace from file's parent folder
  await invoke("open_workspace_in_new_window", {
    workspaceRoot: getParentDir(filePath),
    filePath: filePath,
  });

  if (isLastTab) {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.close();
  } else {
    useTabStore.getState().closeTab(windowLabel, tabId);
  }
}

export function useFileOperations() {
  const windowLabel = useWindowLabel();

  /**
   * Open a file in a new tab. Always creates a new tab unless an existing
   * tab for the same file already exists (in which case it activates that tab).
   */
  const openFileInNewTab = useCallback(
    async (path: string): Promise<void> => {
      perfReset();
      perfMark("openFileInNewTab:start", { path });

      // Check for existing tab first
      const existingTabId = findExistingTabForPath(windowLabel, path);
      if (existingTabId) {
        useTabStore.getState().setActiveTab(windowLabel, existingTabId);
        perfMark("openFileInNewTab:activatedExisting");
        return;
      }

      // Create new tab
      perfStart("createTab");
      const tabId = useTabStore.getState().createTab(windowLabel, path);
      perfEnd("createTab");

      try {
        perfStart("readTextFile");
        const content = await readTextFile(path);
        perfEnd("readTextFile", { size: content.length });

        perfStart("initDocument");
        useDocumentStore.getState().initDocument(tabId, content, path);
        perfEnd("initDocument");

        perfStart("detectLinebreaks");
        const lineMeta = detectLinebreaks(content);
        useDocumentStore.getState().setLineMetadata(tabId, lineMeta);
        perfEnd("detectLinebreaks");

        useRecentFilesStore.getState().addFile(path);
        perfMark("openFileInNewTab:complete");
      } catch (error) {
        console.error("[FileOps] Failed to open file:", path, error);
      }
    },
    [windowLabel]
  );

  const handleOpen = useCallback(async () => {
    await withReentryGuard(windowLabel, "open", async () => {
      perfReset();
      perfMark("handleOpen:start");

      perfStart("openDialog");
      const path = await open({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      perfEnd("openDialog");

      if (!path) return;
      perfMark("handleOpen:fileSelected", { path });

      // Use policy to decide where to open
      const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
      const existingTabId = findExistingTabForPath(windowLabel, path);

      // Check for replaceable tab (single clean untitled tab)
      const replaceableTab = getReplaceableTab(windowLabel);

      const decision = resolveOpenAction({
        filePath: path,
        workspaceRoot: rootPath,
        isWorkspaceMode,
        existingTabId,
        replaceableTab,
      });

      perfMark("handleOpen:resolvedAction", { action: decision.action });

      switch (decision.action) {
        case "activate_tab":
          useTabStore.getState().setActiveTab(windowLabel, decision.tabId);
          perfMark("handleOpen:activatedTab");
          break;
        case "create_tab":
          await openFileInNewTab(path);
          perfMark("handleOpen:createdTab");
          break;
        case "replace_tab":
          // Replace the clean untitled tab with the file content
          try {
            perfStart("replace_tab:readTextFile");
            const content = await readTextFile(path);
            perfEnd("replace_tab:readTextFile", { size: content.length });

            perfStart("replace_tab:updateTabPath");
            useTabStore.getState().updateTabPath(decision.tabId, decision.filePath);
            perfEnd("replace_tab:updateTabPath");

            perfStart("replace_tab:detectLinebreaks");
            const lineMeta = detectLinebreaks(content);
            perfEnd("replace_tab:detectLinebreaks");

            perfStart("replace_tab:loadContent");
            useDocumentStore.getState().loadContent(
              decision.tabId,
              content,
              decision.filePath,
              lineMeta
            );
            perfEnd("replace_tab:loadContent");

            perfStart("replace_tab:openWorkspaceWithConfig");
            await openWorkspaceWithConfig(decision.workspaceRoot);
            perfEnd("replace_tab:openWorkspaceWithConfig");

            useRecentFilesStore.getState().addFile(path);
            perfMark("handleOpen:replacedTab");
          } catch (error) {
            console.error("[FileOps] Failed to replace tab with file:", error);
          }
          break;
        case "open_workspace_in_new_window":
          try {
            await invoke("open_workspace_in_new_window", {
              workspaceRoot: decision.workspaceRoot,
              filePath: decision.filePath,
            });
          } catch (error) {
            console.error("[FileOps] Failed to open workspace in new window:", error);
          }
          break;
        case "no_op":
          // Nothing to do
          break;
      }
    });
  }, [windowLabel, openFileInNewTab]);

  const handleSave = useCallback(async () => {
    flushActiveWysiwygNow();

    await withReentryGuard(windowLabel, "save", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
      if (!doc) return;

      // Check missing file policy - block normal save if file was deleted externally
      const saveAction = resolveMissingFileSaveAction({
        isMissing: doc.isMissing,
        hasPath: Boolean(doc.filePath),
      });

      // Track whether file was untitled before save (for auto-workspace logic)
      const hadPathBeforeSave = Boolean(doc.filePath);
      let savedPath: string | null = null;

      // If file is missing, force Save As flow instead of normal save
      if (saveAction === "save_as_required" || !doc.filePath) {
        // Build default path with suggested filename from tab title
        const tab = useTabStore.getState().tabs[windowLabel]?.find(t => t.id === tabId);
        const filename = tab?.title ? `${tab.title}.md` : "Untitled.md";
        const folder = await getDefaultSaveFolderWithFallback(windowLabel);
        const defaultPath = joinPath(folder, filename);

        const path = await save({
          defaultPath,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (path) {
          const success = await saveToPath(tabId, path, doc.content, "manual");
          if (success) {
            savedPath = path;
            // Clear missing state if file was missing
            if (doc.isMissing) {
              useDocumentStore.getState().clearMissing(tabId);
            }
          }
        }
      } else {
        // Normal save - file exists
        const success = await saveToPath(tabId, doc.filePath, doc.content, "manual");
        if (success) savedPath = doc.filePath;
      }

      // Auto-open workspace after first save of untitled file (if not already in workspace)
      if (savedPath) {
        const { isWorkspaceMode } = useWorkspaceStore.getState();
        const postSaveAction = resolvePostSaveWorkspaceAction({
          isWorkspaceMode,
          hadPathBeforeSave,
          savedFilePath: savedPath,
        });

        if (postSaveAction.action === "open_workspace") {
          try {
            await openWorkspaceWithConfig(postSaveAction.workspaceRoot);
          } catch (error) {
            console.error("[FileOps] Failed to open workspace after save:", error);
          }
        }
      }
    });
  }, [windowLabel]);

  const handleSaveAs = useCallback(async () => {
    flushActiveWysiwygNow();

    await withReentryGuard(windowLabel, "save", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
      if (!doc) return;

      // Pre-fill with current filename or use tab title for untitled files.
      // Tauri dialog: if defaultPath is a file path, it pre-fills the filename input.
      let defaultPath: string;
      if (doc.filePath) {
        // Use full path - dialog will extract filename and folder
        defaultPath = doc.filePath;
      } else {
        // For untitled files, construct path from tab title
        const tab = useTabStore.getState().tabs[windowLabel]?.find(t => t.id === tabId);
        const filename = tab?.title ? `${tab.title}.md` : "Untitled.md";
        const folder = await getDefaultSaveFolderWithFallback(windowLabel);
        defaultPath = joinPath(folder, filename);
      }

      const path = await save({
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (path) {
        const success = await saveToPath(tabId, path, doc.content, "manual");
        if (!success) return;

        // If saved outside workspace, move to new window
        await moveTabToNewWorkspaceWindow(windowLabel, tabId, path);
      }
    });
  }, [windowLabel]);

  const handleMoveTo = useCallback(async () => {
    flushActiveWysiwygNow();

    await withReentryGuard(windowLabel, "move", async () => {
      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);
      if (!doc) return;

      const oldPath = doc.filePath; // null for untitled files

      // Build default path for save dialog
      let defaultPath: string;
      if (oldPath) {
        defaultPath = oldPath;
      } else {
        // Untitled file - use tab title as suggested filename
        const tab = useTabStore.getState().tabs[windowLabel]?.find(t => t.id === tabId);
        const filename = tab?.title ? `${tab.title}.md` : "Untitled.md";
        const folder = await getDefaultSaveFolderWithFallback(windowLabel);
        defaultPath = joinPath(folder, filename);
      }

      const newPath = await save({
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (!newPath || newPath === oldPath) return;

      // Save to new location
      const success = await saveToPath(tabId, newPath, doc.content, "manual");
      if (!success) return;

      // Delete old file (only if there was one)
      if (oldPath) {
        try {
          await remove(oldPath);
        } catch (error) {
          console.error("[FileOps] Failed to delete old file during move:", error);
          // File was saved to new location, but old file couldn't be deleted
          toast.warning("File saved to new location, but couldn't delete original file");
        }
      }

      // If moved outside workspace, open in new window
      await moveTabToNewWorkspaceWindow(windowLabel, tabId, newPath);
    });
  }, [windowLabel]);

  // menu:close now handled by useWindowClose hook via Rust window event

  // Handle opening file from FileExplorer - always opens in new tab
  const handleOpenFile = useCallback(
    async (path: string) => {

      // Check for existing tab and activate, otherwise create new
      const existingTabId = findExistingTabForPath(windowLabel, path);
      if (existingTabId) {
        useTabStore.getState().setActiveTab(windowLabel, existingTabId);
      } else {
        await openFileInNewTab(path);
      }
    },
    [openFileInNewTab, windowLabel]
  );

  const handleNew = useCallback(() => {
    createUntitledTab(windowLabel);
  }, [windowLabel]);

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();

      // menu:new creates a new tab in this window
      // menu:new-window (handled in Rust) creates a new window
      const unlistenNew = await currentWindow.listen<string>("menu:new", (event) => {
        if (event.payload !== windowLabel) return;
        handleNew();
      });
      if (cancelled) { unlistenNew(); return; }
      unlistenRefs.current.push(unlistenNew);

      const unlistenOpen = await currentWindow.listen<string>("menu:open", async (event) => {
        if (event.payload !== windowLabel) return;
        await handleOpen();
      });
      if (cancelled) { unlistenOpen(); return; }
      unlistenRefs.current.push(unlistenOpen);

      const unlistenSave = await currentWindow.listen<string>("menu:save", async (event) => {
        if (event.payload !== windowLabel) return;
        await handleSave();
      });
      if (cancelled) { unlistenSave(); return; }
      unlistenRefs.current.push(unlistenSave);

      const unlistenSaveAs = await currentWindow.listen<string>("menu:save-as", async (event) => {
        if (event.payload !== windowLabel) return;
        await handleSaveAs();
      });
      if (cancelled) { unlistenSaveAs(); return; }
      unlistenRefs.current.push(unlistenSaveAs);

      const unlistenMoveTo = await currentWindow.listen<string>("menu:move-to", async (event) => {
        if (event.payload !== windowLabel) return;
        await handleMoveTo();
      });
      if (cancelled) { unlistenMoveTo(); return; }
      unlistenRefs.current.push(unlistenMoveTo);

      // Save All and Quit - saves all dirty documents then quits
      const unlistenSaveAllQuit = await currentWindow.listen<string>(
        "menu:save-all-quit",
        async (event) => {
          if (event.payload !== windowLabel) return;

          await withReentryGuard(windowLabel, "save-all-quit", async () => {
            try {
              // Flush any pending editor changes before reading dirty state
              flushActiveWysiwygNow();

              // Get all dirty tab IDs
              const dirtyTabIds = useDocumentStore.getState().getAllDirtyDocuments();
              if (dirtyTabIds.length === 0) {
                // No dirty docs, quit immediately
                await invoke("force_quit");
                return;
              }

              // Build save contexts by looking up document and tab info
              const tabStore = useTabStore.getState();
              const docStore = useDocumentStore.getState();
              const contexts: CloseSaveContext[] = [];

              // Build tabId -> {windowLabel, title} map for O(1) lookup
              const tabOwnership = new Map<string, { windowLabel: string; title: string }>();
              for (const [wLabel, tabs] of Object.entries(tabStore.tabs)) {
                for (const tab of tabs) {
                  tabOwnership.set(tab.id, { windowLabel: wLabel, title: tab.title });
                }
              }

              // Find window label and title for each dirty tab
              for (const tabId of dirtyTabIds) {
                const doc = docStore.getDocument(tabId);
                if (!doc?.isDirty) continue;

                const ownership = tabOwnership.get(tabId);
                contexts.push({
                  windowLabel: ownership?.windowLabel ?? windowLabel,
                  tabId,
                  title: ownership?.title ?? doc.filePath ?? "Untitled",
                  filePath: doc.filePath,
                  content: doc.content,
                });
              }

              if (contexts.length === 0) {
                await invoke("force_quit");
                return;
              }

              // Save all documents (will prompt for folder if multiple untitled)
              const result = await saveAllDocuments(contexts);
              if (result.action === "saved-all") {
                await invoke("force_quit");
              }
              // If cancelled, do nothing (stay in app)
            } catch (error) {
              console.error("[SaveAllQuit] Failed:", error);
              toast.error("Failed to save documents");
            }
          });
        }
      );
      if (cancelled) { unlistenSaveAllQuit(); return; }
      unlistenRefs.current.push(unlistenSaveAllQuit);

      // Listen for open-file from FileExplorer (window-local event, payload contains path)
      const unlistenOpenFile = await currentWindow.listen<{ path: string }>(
        "open-file",
        async (event) => {
          await handleOpenFile(event.payload.path);
        }
      );
      if (cancelled) { unlistenOpenFile(); return; }
      unlistenRefs.current.push(unlistenOpenFile);
    };

    setupListeners();

    // Keyboard shortcut handler for file operations
    // Menu accelerators don't always work reliably (TipTap captures events),
    // so we listen directly for Save and Save As shortcuts.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const shortcuts = useShortcutsStore.getState();

      // Save As (Cmd+Shift+S)
      const saveAsKey = shortcuts.getShortcut("saveAs");
      if (matchesShortcutEvent(e, saveAsKey)) {
        e.preventDefault();
        handleSaveAs();
        return;
      }

      // Save (Cmd+S)
      const saveKey = shortcuts.getShortcut("save");
      if (matchesShortcutEvent(e, saveKey)) {
        e.preventDefault();
        handleSave();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleMoveTo, handleOpenFile, windowLabel]);
}
