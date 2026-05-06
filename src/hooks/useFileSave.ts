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

import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import {
  dispatchEditor,
  getFormatById,
} from "@/lib/formats/registry";
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
import { fileOpsLog, fileOpsWarn, fileOpsError } from "@/utils/debug";

/**
 * Open a native save dialog and return the chosen path (or null on cancel).
 *
 * We intentionally skip file-type filters because macOS 26 (Tahoe) deprecated
 * the `setAllowedFileTypes` API used by rfd, causing the dialog to hang or
 * crash. Omitting filters avoids the issue entirely — the default filename
 * already carries the `.md` extension, so users still save as Markdown.
 */
export async function saveDialogWithFallback(
  defaultPath: string,
): Promise<string | null> {
  return save({ defaultPath });
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
  // Only close current tab/window if the new window opened successfully
  try {
    await invoke("open_workspace_in_new_window", {
      workspaceRoot: getParentDir(filePath),
      filePath: filePath,
    });
  } catch (error) {
    fileOpsError("Failed to open workspace in new window:", error);
    toast.error(i18n.t("dialog:toast.failedToMoveToNewWindow"));
    return;
  }

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
  // WI-1B.9 — default extension is the active format's
  // untitledExtension. Untitled tab → "markdown" formatId → ".md".
  let ext = "md";
  try {
    const cfg = tab?.formatId
      ? (getFormatById(tab.formatId) ?? dispatchEditor(tab.filePath ?? null))
      : dispatchEditor(tab?.filePath ?? null);
    ext = cfg.adapters.untitledExtension;
  } catch {
    /* registry not bootstrapped — keep .md default */
  }
  const filename = `${suggestedName}.${ext}`;
  const folder = await getDefaultSaveFolderWithFallback(windowLabel);
  return joinPath(folder, filename);
}

/**
 * Handle Save (Cmd+S) — save current document, prompting for path if untitled.
 */
export async function handleSave(windowLabel: string): Promise<void> {
  fileOpsLog("handleSave called for window:", windowLabel);
  flushActiveWysiwygNow();

  const guardResult = await withReentryGuard(windowLabel, "save", async () => {
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) {
      fileOpsWarn("No active tab for save in window:", windowLabel);
      return;
    }

    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc) {
      fileOpsWarn("No document found for tab:", tabId);
      return;
    }

    fileOpsLog("Save target:", {
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
    let needsSaveAs = saveAction === "save_as_required" || !doc.filePath;

    // Try the normal save path first if we have a file on disk
    if (!needsSaveAs && doc.filePath) {
      const success = await saveToPath(tabId, doc.filePath, doc.content, "manual");
      if (success) {
        savedPath = doc.filePath;
      } else {
        // saveToPath flips isMissing when the parent directory has vanished
        // (renamed/deleted externally). Re-check and fall through to Save As
        // so the user can recover in one click instead of having to retry.
        const refreshed = useDocumentStore.getState().getDocument(tabId);
        if (refreshed?.isMissing) {
          fileOpsLog("Parent directory missing after save attempt — routing to Save As");
          needsSaveAs = true;
        }
      }
    }

    // Save As: untitled, missing-on-open, or parent-missing recovery
    if (needsSaveAs && !savedPath) {
      fileOpsLog("Entering Save As flow (untitled or missing file)");
      const defaultPath = await buildDefaultSavePath(windowLabel, tabId, doc.content, null);
      fileOpsLog("Opening save dialog with defaultPath:", defaultPath);

      let path: string | null;
      try {
        path = await saveDialogWithFallback(defaultPath);
        fileOpsLog("Save dialog returned:", path ?? "(cancelled)");
      } catch (error) {
        fileOpsError("Save dialog threw:", error);
        toast.error(
          i18n.t("dialog:toast.saveDialogFailed", { error: error instanceof Error ? error.message : String(error) }),
          { pin: true },
        );
        return;
      }

      if (path) {
        const success = await saveToPath(tabId, path, doc.content, "manual");
        /* v8 ignore start -- @preserve saveToPath failure and isMissing paths not exercised in tests */
        if (success) {
          savedPath = path;
          // Clear missing state — pre-existing or just set during recovery
          const currentDoc = useDocumentStore.getState().getDocument(tabId);
          if (currentDoc?.isMissing) {
            useDocumentStore.getState().clearMissing(tabId);
          }
        }
        /* v8 ignore stop */
      }
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
          fileOpsError("Failed to open workspace after save:", error);
        }
      }
    }
  });
  /* v8 ignore start -- @preserve re-entry guard branch (guardResult === undefined) not exercised in tests */
  if (guardResult === undefined) {
    fileOpsWarn("Save blocked by re-entry guard (another save in progress)");
  }
  /* v8 ignore stop */
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
      fileOpsError("Save As dialog threw:", error);
      toast.error(
        i18n.t("dialog:toast.saveDialogFailed", { error: error instanceof Error ? error.message : String(error) }),
        { pin: true },
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
      fileOpsError("Move To dialog threw:", error);
      toast.error(
        i18n.t("dialog:toast.saveDialogFailed", { error: error instanceof Error ? error.message : String(error) }),
        { pin: true },
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
        fileOpsError("Failed to delete old file during move:", error);
        // File was saved to new location, but old file couldn't be deleted
        toast.warning(i18n.t("dialog:toast.fileMovedCantDeleteOriginal"));
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
      fileOpsError("SaveAllQuit failed:", error);
      toast.error(i18n.t("dialog:toast.failedToSaveDocuments"));
    }
  });
}
