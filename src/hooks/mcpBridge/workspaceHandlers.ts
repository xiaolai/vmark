/**
 * MCP Bridge - Workspace and Window Operation Handlers
 */

import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getFileName } from "@/utils/paths";
import { respond, getEditor, resolveWindowId } from "./utils";

/**
 * Handle windows.list request.
 */
export async function handleWindowsList(id: string): Promise<void> {
  try {
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId["main"];
    const doc = activeTabId ? docStore.getDocument(activeTabId) : undefined;

    await respond({
      id,
      success: true,
      data: [
        {
          label: "main",
          title: doc?.filePath ? getFileName(doc.filePath) || "Untitled" : "Untitled",
          filePath: doc?.filePath ?? null,
          isFocused: true,
          isAiExposed: true,
        },
      ],
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle windows.getFocused request.
 */
export async function handleWindowsGetFocused(id: string): Promise<void> {
  try {
    await respond({ id, success: true, data: "main" });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle windows.focus request.
 * Focuses a specific window by its label.
 */
export async function handleWindowsFocus(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = args.windowId as string;
    if (!windowId) {
      throw new Error("windowId is required");
    }

    // For now, VMark is single-window, so we just focus the current window
    // In the future, this could use WebviewWindow.getByLabel(windowId)
    const currentWindow = getCurrentWindow();
    await currentWindow.setFocus();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.newDocument request.
 */
export async function handleWorkspaceNewDocument(id: string): Promise<void> {
  try {
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    // Create new tab and initialize empty document
    const tabId = tabStore.createTab("main", null);
    docStore.initDocument(tabId, "", null);

    // Return windowId as expected by MCP server
    await respond({ id, success: true, data: { windowId: "main" } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.openDocument request.
 * Opens a document from the filesystem.
 */
export async function handleWorkspaceOpenDocument(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const path = args.path as string;
    if (!path) {
      throw new Error("path is required");
    }

    // Read file content
    const content = await readTextFile(path);

    // Create new tab and initialize document with content
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();

    const tabId = tabStore.createTab("main", path);
    docStore.initDocument(tabId, content, path);

    await respond({ id, success: true, data: { windowId: "main" } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.saveDocument request.
 */
export async function handleWorkspaceSaveDocument(id: string): Promise<void> {
  try {
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId["main"];

    if (!activeTabId) {
      throw new Error("No active document");
    }

    const doc = docStore.getDocument(activeTabId);
    if (!doc?.filePath) {
      throw new Error("Document has no file path (use save-as instead)");
    }

    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const content = serializeMarkdown(editor.state.schema, editor.state.doc);
    await writeTextFile(doc.filePath, content);
    docStore.markSaved(activeTabId);

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.closeWindow request.
 */
export async function handleWorkspaceCloseWindow(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(args.windowId as string | undefined);
    const tabStore = useTabStore.getState();
    const activeTabId = tabStore.activeTabId[windowId];

    if (activeTabId) {
      tabStore.closeTab(windowId, activeTabId);
    }

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.saveDocumentAs request.
 * Saves the document to a new path.
 */
export async function handleWorkspaceSaveDocumentAs(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const path = args.path as string;
    if (!path) {
      throw new Error("path is required");
    }

    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId["main"];

    if (!activeTabId) {
      throw new Error("No active document");
    }

    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const content = serializeMarkdown(editor.state.schema, editor.state.doc);
    await writeTextFile(path, content);

    // Update tab and document with new path
    tabStore.updateTabPath(activeTabId, path);
    tabStore.updateTabTitle(activeTabId, getFileName(path) || "Untitled");
    docStore.setFilePath(activeTabId, path);
    docStore.markSaved(activeTabId);

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.getDocumentInfo request.
 * Gets document metadata.
 */
export async function handleWorkspaceGetDocumentInfo(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const windowId = resolveWindowId(args.windowId as string | undefined);
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId[windowId];

    if (!activeTabId) {
      throw new Error("No active document");
    }

    const doc = docStore.getDocument(activeTabId);
    const tab = tabStore.tabs[windowId]?.find((t) => t.id === activeTabId);
    const editor = getEditor();

    // Calculate word and character count from editor content
    let wordCount = 0;
    let charCount = 0;
    if (editor) {
      const text = editor.state.doc.textContent;
      charCount = text.length;
      wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    }

    await respond({
      id,
      success: true,
      data: {
        filePath: doc?.filePath ?? null,
        isDirty: doc?.isDirty ?? false,
        title: tab?.title ?? "Untitled",
        wordCount,
        charCount,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.listRecentFiles request.
 * Returns list of recently opened files.
 */
export async function handleWorkspaceListRecentFiles(id: string): Promise<void> {
  try {
    const recentFilesStore = useRecentFilesStore.getState();
    const files = recentFilesStore.files;

    await respond({
      id,
      success: true,
      data: files,
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle workspace.getInfo request.
 * Returns workspace state information.
 */
export async function handleWorkspaceGetInfo(id: string): Promise<void> {
  try {
    const workspaceStore = useWorkspaceStore.getState();
    const { isWorkspaceMode, rootPath } = workspaceStore;

    // Extract workspace name from root path
    let workspaceName: string | null = null;
    if (rootPath) {
      const parts = rootPath.split("/");
      workspaceName = parts[parts.length - 1] || null;
    }

    await respond({
      id,
      success: true,
      data: {
        isWorkspaceMode,
        rootPath,
        workspaceName,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

