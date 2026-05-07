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

import { imeToast as toast } from "@/utils/imeToast";
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
import { routeOpenBySize } from "@/utils/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { getSupportedExtensions } from "@/lib/formats/registry";
import { useFileLoadStore } from "@/stores/fileLoadStore";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";

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

  // Show the indeterminate "Opening large file…" indicator when the file is
  // past the progress threshold AND the open is going to WYSIWYG (Source mode
  // opens are sub-second — the indicator would flash and confuse).
  const showIndicator =
    !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
  let loadId: number | null = null;
  if (showIndicator) {
    const filename = path.split("/").pop() ?? path;
    loadId = useFileLoadStore.getState().startLoad(filename, route.sizeBytes);
  }

  try {
    perfStart("readTextFile");
    const content = await readTextFile(path);
    perfEnd("readTextFile", { size: content.length });

    // WI-2.6 — YAML force-source bandaid retired. YAML files now route
    // through the YAML adapter (kind: split-pane) via the format
    // registry, so they bypass the markdown WYSIWYG path entirely.

    perfStart("initDocument");
    useDocumentStore.getState().initDocument(tabId, content, path);
    perfEnd("initDocument");

    perfStart("detectLinebreaks");
    const lineMeta = detectLinebreaks(content);
    useDocumentStore.getState().setLineMetadata(tabId, lineMeta);
    perfEnd("detectLinebreaks");

    useRecentFilesStore.getState().addFile(path);

    // Large / huge file: mark the tab as forced-source via the markdown
    // adapter helper (WI-1A.6). For non-markdown formats this is a no-op
    // since they don't have a WYSIWYG path.
    maybeMarkLargeMarkdownAsSource(tabId, path, route.forceSourceMode);

    perfMark("openFileInNewTab:complete");
    // On success, the indicator stays on until TiptapEditor's onCreate fires
    // endLoad() — that is the moment the editor is actually interactive.
  } catch (error) {
    fileOpsError("Failed to open file:", path, error);
    // Clean up the orphaned tab — without initDocument, it renders blank.
    // Use detachTab (not closeTab) to avoid polluting the "reopen closed tab" history.
    useTabStore.getState().detachTab(windowLabel, tabId);
    const msg = error instanceof Error ? error.message : String(error);
    // Pin: system errors include paths/codes worth reading carefully.
    toast.error(i18n.t("dialog:toast.failedToOpenFile", { error: msg }), {
      pin: true,
    });
    // Clear the indicator immediately on error so no stale spinner lingers.
    if (loadId !== null) useFileLoadStore.getState().endLoad(loadId);
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
    // WI-1B.1 — "All Supported" preset (every registered format) plus
    // a Markdown-only preset for the user who wants the legacy filter.
    // Filter names are localized via dialog:openFilter.* — only the
    // extension lists stay registry-driven.
    const allExtensions = getSupportedExtensions();
    const path = await open({
      filters: [
        {
          name: i18n.t("dialog:openFilter.allSupported"),
          extensions: [...allExtensions],
        },
        {
          name: i18n.t("dialog:openFilter.markdown"),
          extensions: ["md", "markdown", "mdown", "mkd", "mdx"],
        },
      ],
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
      case "replace_tab": {
        // Replace the clean untitled tab with the file content.
        // Pre-read size gate so refused / cancelled / huge files honor the
        // large-file UX even on this branch.
        const route = await routeOpenBySize(path);
        if (!route.proceed) {
          perfMark("handleOpen:replaceTabRefusedOrCancelled");
          break;
        }

        const showIndicator =
          !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
        let replaceLoadId: number | null = null;
        if (showIndicator) {
          const filename = path.split("/").pop() ?? path;
          replaceLoadId = useFileLoadStore
            .getState()
            .startLoad(filename, route.sizeBytes);
        }

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

          maybeMarkLargeMarkdownAsSource(
            decision.tabId,
            path,
            route.forceSourceMode,
          );

          perfMark("handleOpen:replacedTab");
        } catch (error) {
          fileOpsError("Failed to replace tab with file:", error);
          if (replaceLoadId !== null) {
            useFileLoadStore.getState().endLoad(replaceLoadId);
          }
          const msg = error instanceof Error ? error.message : String(error);
          // Pin: system error includes paths and codes the user may want
          // to copy to investigate (permission denied, missing file, etc.)
          toast.error(i18n.t("dialog:toast.fileOpenFailed", { error: msg }), {
            pin: true,
          });
        }
        break;
      }
      case "open_workspace_in_new_window":
        try {
          await invoke("open_workspace_in_new_window", {
            workspaceRoot: decision.workspaceRoot,
            filePath: decision.filePath,
          });
        } catch (error) {
          fileOpsError("Failed to open workspace in new window:", error);
          toast.error(i18n.t("dialog:toast.openWorkspaceInNewWindowFailed"));
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
