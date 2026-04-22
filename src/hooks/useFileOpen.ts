/**
 * File Open Utilities
 *
 * Purpose: Core file-open operations — read file into a new tab, handle
 *   open dialog with workspace/tab resolution, and create new untitled tabs.
 *
 * @coordinates-with useReplaceableTab.ts — reuses empty untitled tabs on file open
 * @coordinates-with documentStore.ts — reads/writes document content and dirty state
 * @coordinates-with useFileOperations.ts — orchestrates open handlers via menu events
 * @module hooks/useFileOpen
 */

import { toast } from "sonner";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { fileOpsError } from "@/utils/debug";
import { perfReset, perfStart, perfEnd, perfMark } from "@/utils/perfLog";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { createUntitledTab } from "@/utils/newFile";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { isYamlFileName } from "@/utils/dropPaths";
import { isWorkflowEnabled } from "@/utils/workflowFeatureFlag";
import { routeOpenBySize } from "@/utils/largeFileRouting";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";

/**
 * Open a file in a new tab (core logic).
 * Creates the tab, reads the file, and initializes the document.
 * On failure, cleans up the orphaned tab and shows a toast error.
 * @internal Exported for testing
 */
export async function openFileInNewTabCore(
  windowLabel: string,
  path: string
): Promise<void> {
  // Pre-read size check: refused files never create a tab; huge files
  // confirm before going further; routeOpenBySize is a no-op for small files.
  const route = await routeOpenBySize(path);
  if (!route.proceed) {
    perfMark("openFileInNewTab:refusedOrCancelled");
    return;
  }

  perfStart("createTab");
  // Detect dedup by comparing tab count before/after createTab.
  // Ideally createTab would return { tabId, created } but changing its
  // return type is a wider refactor — this count-based check is a safe
  // interim guard since createTab is synchronous.
  const tabCountBefore = useTabStore.getState().getTabsByWindow(windowLabel).length;
  const tabId = useTabStore.getState().createTab(windowLabel, path);
  const isExistingTab = useTabStore.getState().getTabsByWindow(windowLabel).length === tabCountBefore;
  perfEnd("createTab");

  // createTab deduped to an existing tab — just activate, don't overwrite content
  if (isExistingTab) {
    perfMark("openFileInNewTab:deduped");
    return;
  }

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

    // Auto-switch to source mode for YAML workflow files (feature-flagged)
    const fileName = path.split("/").pop() ?? "";
    if (isWorkflowEnabled() && isYamlFileName(fileName)) {
      const { useEditorStore } = await import("@/stores/editorStore");
      if (!useEditorStore.getState().sourceMode) {
        useEditorStore.getState().setSourceMode(true);
      }
    } else if (route.forceSourceMode) {
      // Large / huge file: honor the route decision by switching to Source mode
      // and marking the tab so the StatusBar can offer an explicit upgrade back.
      const { useEditorStore } = await import("@/stores/editorStore");
      if (!useEditorStore.getState().sourceMode) {
        useEditorStore.getState().setSourceMode(true);
      }
      useLargeFileSessionStore.getState().markForcedSource(tabId);
    }

    perfMark("openFileInNewTab:complete");
  } catch (error) {
    fileOpsError("Failed to open file:", path, error);
    // Clean up the orphaned tab — without initDocument, it renders blank.
    // Use detachTab (not closeTab) to avoid polluting the "reopen closed tab" history.
    useTabStore.getState().detachTab(windowLabel, tabId);
    const msg = error instanceof Error ? error.message : String(error);
    toast.error(i18n.t("dialog:toast.failedToOpenFile", { error: msg }));
  }
}

/**
 * Open a file in a new tab. Always creates a new tab unless an existing
 * tab for the same file already exists (in which case it activates that tab).
 */
export async function openFileInNewTab(
  windowLabel: string,
  path: string
): Promise<void> {
  perfReset();
  perfMark("openFileInNewTab:start", { path });

  // Check for existing tab first
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    useTabStore.getState().setActiveTab(windowLabel, existingTabId);
    perfMark("openFileInNewTab:activatedExisting");
    return;
  }

  await openFileInNewTabCore(windowLabel, path);
}

/**
 * Handle Open dialog (Cmd+O) — show file picker, resolve action, open file.
 */
export async function handleOpen(windowLabel: string): Promise<void> {
  await withReentryGuard(windowLabel, "open", async () => {
    perfReset();
    perfMark("handleOpen:start");

    perfStart("openDialog");
    const path = await open({
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] }],
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
        await openFileInNewTab(windowLabel, path);
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
          fileOpsError("Failed to replace tab with file:", error);
        }
        break;
      case "open_workspace_in_new_window":
        try {
          await invoke("open_workspace_in_new_window", {
            workspaceRoot: decision.workspaceRoot,
            filePath: decision.filePath,
          });
        } catch (error) {
          fileOpsError("Failed to open workspace in new window:", error);
        }
        break;
      case "no_op":
        // Nothing to do
        break;
    }
  });
}

/**
 * Handle opening file from FileExplorer — always opens in new tab.
 */
export async function handleOpenFile(
  windowLabel: string,
  path: string
): Promise<void> {
  // Check for existing tab and activate, otherwise create new
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    useTabStore.getState().setActiveTab(windowLabel, existingTabId);
  } else {
    await openFileInNewTab(windowLabel, path);
  }
}

/**
 * Handle New (Cmd+N) — create a new untitled tab.
 */
export function handleNew(windowLabel: string): void {
  createUntitledTab(windowLabel);
}
