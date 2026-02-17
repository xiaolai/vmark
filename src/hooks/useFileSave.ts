/**
 * File Save Utilities
 *
 * Purpose: Core save operations — save dialog with macOS Tahoe fallback,
 *   move tab to new workspace window, and Save/Save As/Move To handlers.
 *
 * @coordinates-with closeSave.ts — shared save prompt for dirty documents
 * @coordinates-with useFileOperations.ts — orchestrates save handlers via menu events
 * @module hooks/useFileSave
 */

import { toast } from "sonner";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { saveToPath } from "@/utils/saveToPath";
import {
  resolvePostSaveWorkspaceAction,
  resolveMissingFileSaveAction,
} from "@/utils/openPolicy";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { joinPath } from "@/utils/pathUtils";
import { getSaveFileName } from "@/utils/exportNaming";
import { isWithinRoot, getParentDir } from "@/utils/paths";
import { saveAllDocuments, type CloseSaveContext } from "@/hooks/closeSave";

/**
 * Save dialog with timeout and filter fallback for macOS Tahoe compatibility.
 *
 * macOS 26 (Tahoe) has known issues with NSSavePanel:
 *   - XPC service hangs/crashes ("Open and Save Panel Service" stuck)
 *   - Deprecated setAllowedFileTypes API (removed behavior in Tahoe)
 *   - Slow/frozen dialog rendering
 *
 * Strategy:
 *   1. Try with file type filters (normal path)
 *   2. If it times out (15s), retry WITHOUT filters to bypass deprecated API
 *   3. If retry also fails, throw so caller can show error toast
 *
 * @coordinates-with panel_ffi.rs — rfd uses setAllowedFileTypes when filters present
 */
export async function saveDialogWithFallback(
  defaultPath: string,
): Promise<string | null> {
  const DIALOG_TIMEOUT_MS = 15_000;

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Save dialog timed out after ${ms / 1000}s`)),
        ms,
      );
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  };

  // Attempt 1: with filters (normal)
  try {
    console.log("[FileOps] Save dialog attempt 1: with filters");
    const path = await withTimeout(
      save({
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }),
      DIALOG_TIMEOUT_MS,
    );
    return path;
  } catch (firstError) {
    console.warn("[FileOps] Save dialog attempt 1 failed:", firstError);

    // If it timed out, retry without filters to bypass deprecated setAllowedFileTypes
    if (firstError instanceof Error && firstError.message.includes("timed out")) {
      console.log("[FileOps] Save dialog attempt 2: without filters (Tahoe workaround)");
      try {
        const path = await withTimeout(
          save({ defaultPath }),
          DIALOG_TIMEOUT_MS,
        );
        return path;
      } catch (secondError) {
        console.error("[FileOps] Save dialog attempt 2 also failed:", secondError);
        throw secondError;
      }
    }

    // Non-timeout error — propagate immediately
    throw firstError;
  }
}

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

/**
 * Build default path for save dialog from document content and tab info.
 */
async function buildDefaultSavePath(
  windowLabel: string,
  tabId: string,
  content: string,
  existingPath: string | null,
): Promise<string> {
  if (existingPath) return existingPath;

  const tab = useTabStore.getState().tabs[windowLabel]?.find(t => t.id === tabId);
  const suggestedName = getSaveFileName(content, tab?.title ?? "");
  const filename = `${suggestedName}.md`;
  const folder = await getDefaultSaveFolderWithFallback(windowLabel);
  return joinPath(folder, filename);
}

/**
 * Handle Save (Cmd+S) — save current document, prompting for path if untitled.
 */
export async function handleSave(windowLabel: string): Promise<void> {
  console.log("[FileOps] handleSave called for window:", windowLabel);
  flushActiveWysiwygNow();

  const guardResult = await withReentryGuard(windowLabel, "save", async () => {
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) {
      console.warn("[FileOps] No active tab for save in window:", windowLabel);
      return;
    }

    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc) {
      console.warn("[FileOps] No document found for tab:", tabId);
      return;
    }

    console.log("[FileOps] Save target:", {
      tabId,
      filePath: doc.filePath ?? "(untitled)",
      isMissing: doc.isMissing,
      isDirty: doc.isDirty,
    });

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
      console.log("[FileOps] Entering Save As flow (untitled or missing file)");
      const defaultPath = await buildDefaultSavePath(windowLabel, tabId, doc.content, null);
      console.log("[FileOps] Opening save dialog with defaultPath:", defaultPath);

      let path: string | null;
      try {
        path = await saveDialogWithFallback(defaultPath);
        console.log("[FileOps] Save dialog returned:", path ?? "(cancelled)");
      } catch (error) {
        console.error("[FileOps] Save dialog threw:", error);
        toast.error(
          `Save dialog failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }

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
  if (guardResult === undefined) {
    console.warn("[FileOps] Save blocked by re-entry guard (another save in progress)");
  }
}

/**
 * Handle Save As (Cmd+Shift+S) — always prompt for new file path.
 */
export async function handleSaveAs(windowLabel: string): Promise<void> {
  flushActiveWysiwygNow();

  await withReentryGuard(windowLabel, "save", async () => {
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) return;

    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc) return;

    const defaultPath = await buildDefaultSavePath(windowLabel, tabId, doc.content, doc.filePath);

    let path: string | null;
    try {
      path = await saveDialogWithFallback(defaultPath);
    } catch (error) {
      console.error("[FileOps] Save As dialog threw:", error);
      toast.error(
        `Save dialog failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    if (path) {
      const success = await saveToPath(tabId, path, doc.content, "manual");
      if (!success) return;

      // If saved outside workspace, move to new window
      await moveTabToNewWorkspaceWindow(windowLabel, tabId, path);
    }
  });
}

/**
 * Handle Move To — save to new location and delete old file.
 */
export async function handleMoveTo(windowLabel: string): Promise<void> {
  flushActiveWysiwygNow();

  await withReentryGuard(windowLabel, "move", async () => {
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) return;

    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc) return;

    const oldPath = doc.filePath; // null for untitled files
    const defaultPath = await buildDefaultSavePath(windowLabel, tabId, doc.content, oldPath);

    let newPath: string | null;
    try {
      newPath = await saveDialogWithFallback(defaultPath);
    } catch (error) {
      console.error("[FileOps] Move To dialog threw:", error);
      toast.error(
        `Save dialog failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

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
}

/**
 * Handle Save All and Quit — save all dirty documents then force quit.
 */
export async function handleSaveAllQuit(windowLabel: string): Promise<void> {
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
