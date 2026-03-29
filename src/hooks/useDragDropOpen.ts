/**
 * Drag-Drop File Open Hook
 *
 * Purpose: Handles markdown files dragged from Finder into the app —
 *   opens in a new tab (if within workspace) or new window (if outside).
 *
 * Pipeline: Finder drag → Tauri drag-drop event → filter for .md files →
 *   resolveOpenAction() decides tab vs window → open accordingly
 *
 * Key decisions:
 *   - Files within workspace open as new tabs
 *   - Files outside workspace open in new window with file's parent as workspace
 *   - Image files handled by useImageDragDrop instead (not here)
 *
 * @coordinates-with useImageDragDrop.ts — handles image file drops
 * @coordinates-with openPolicy.ts — resolveOpenAction for tab vs window decision
 * @module hooks/useDragDropOpen
 */
import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { filterMarkdownPaths } from "@/utils/dropPaths";
import { resolveOpenAction, resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { dragDropError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";

/**
 * Opens a file in a new tab (or activates existing tab if already open).
 *
 * @param windowLabel - The window to open the file in
 * @param path - The file path to open
 */
async function openFileInNewTab(windowLabel: string, path: string): Promise<void> {
  // Check for existing tab first
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    useTabStore.getState().setActiveTab(windowLabel, existingTabId);
    return;
  }

  try {
    const content = await readTextFile(path);
    const tabId = useTabStore.getState().createTab(windowLabel, path);
    useDocumentStore.getState().initDocument(tabId, content, path);
    useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
    useRecentFilesStore.getState().addFile(path);
  } catch (error) {
    dragDropError("Failed to open file:", path, error);
    const filename = getFileName(path) || path;
    toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
  }
}

/**
 * Hook to handle drag-and-drop file opening.
 *
 * When markdown files (.md, .markdown, .txt) are dropped onto the window,
 * they are opened in new tabs. Non-markdown files are silently ignored.
 *
 * @example
 * function DocumentWindow() {
 *   useDragDropOpen();
 *   return <Editor />;
 * }
 */
export function useDragDropOpen(): void {
  const windowLabel = useWindowLabel();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setupDragDrop = async () => {
      const webview = getCurrentWebview();

      const unlisten = await webview.onDragDropEvent(async (event) => {
        if (cancelled) return;

        const { type } = event.payload;

        // Handle drag enter for visual feedback
        if (type === "enter") {
          // Check if any markdown files are being dragged
          const paths = event.payload.paths;
          const hasMarkdown = paths.some((p: string) =>
            [".md", ".markdown", ".txt"].some((ext) => p.toLowerCase().endsWith(ext))
          );
          if (hasMarkdown) {
            useUIStore.getState().setDraggingFiles(true);
          }
          return;
        }

        // Ignore over events (just position updates)
        if (type === "over") {
          return;
        }

        if (type === "leave") {
          useUIStore.getState().setDraggingFiles(false);
          return;
        }

        // Handle drop event
        if (type !== "drop") return;

        // Clear dragging state on drop
        useUIStore.getState().setDraggingFiles(false);

        const paths = event.payload.paths;
        const markdownPaths = filterMarkdownPaths(paths);
        if (markdownPaths.length === 0) {
          if (paths.length > 0) {
            toast.info(i18n.t("dialog:toast.onlyMarkdownViaDropDrop"));
          }
          return;
        }

        // Get current workspace state for policy decisions
        const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
        const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
        const hasDirtyTabs = tabs.some((tab) => {
          const doc = useDocumentStore.getState().getDocument(tab.id);
          return doc?.isDirty;
        });

        const initialReplaceableTab = getReplaceableTab(windowLabel);
        let replaceableTabUsed = false;

        if (!isWorkspaceMode && hasDirtyTabs) {
          const groups = new Map<string, string[]>();
          const rootless: string[] = [];

          for (const path of markdownPaths) {
            const root = resolveWorkspaceRootForExternalFile(path);
            if (root) {
              const existing = groups.get(root) ?? [];
              existing.push(path);
              groups.set(root, existing);
            } else {
              rootless.push(path);
            }
          }

          for (const [workspaceRoot, files] of groups.entries()) {
            try {
              await invoke("open_workspace_with_files_in_new_window", {
                workspaceRoot,
                filePaths: files,
              });
            } catch (error) {
              dragDropError("Failed to open workspace in new window:", error);
              toast.error(i18n.t("dialog:toast.failedToOpenFilesInNewWindow"));
            }
          }

          for (const path of rootless) {
            try {
              await invoke("open_file_in_new_window", { path });
            } catch (error) {
              dragDropError("Failed to open file in new window:", error);
              const filename = getFileName(path) || path;
              toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
            }
          }

          return;
        }

        // If not in workspace mode, and all dropped files share the same root,
        // open that workspace in the current window and load as tabs.
        if (!isWorkspaceMode) {
          const roots = markdownPaths
            .map((path) => resolveWorkspaceRootForExternalFile(path))
            .filter((root): root is string => Boolean(root));
          const uniqueRoots = new Set(roots);

          if (uniqueRoots.size === 1) {
            const [batchRoot] = uniqueRoots;
            await openWorkspaceWithConfig(batchRoot);

            for (const path of markdownPaths) {
              if (!replaceableTabUsed && initialReplaceableTab) {
                try {
                  const content = await readTextFile(path);
                  useTabStore.getState().updateTabPath(initialReplaceableTab.tabId, path);
                  useDocumentStore.getState().loadContent(
                    initialReplaceableTab.tabId,
                    content,
                    path,
                    detectLinebreaks(content)
                  );
                  useRecentFilesStore.getState().addFile(path);
                  replaceableTabUsed = true;
                  continue;
                } catch (error) {
                  dragDropError("Failed to replace tab with file:", path, error);
                  const filename = getFileName(path) || path;
                  toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
                }
              }

              await openFileInNewTab(windowLabel, path);
            }
            return;
          }
        }

        for (const path of markdownPaths) {
          const existingTabId = findExistingTabForPath(windowLabel, path);
          const replaceableTab = replaceableTabUsed ? null : initialReplaceableTab;

          const decision = resolveOpenAction({
            filePath: path,
            workspaceRoot: rootPath,
            isWorkspaceMode,
            existingTabId,
            replaceableTab,
          });

          switch (decision.action) {
            case "activate_tab":
              useTabStore.getState().setActiveTab(windowLabel, decision.tabId);
              break;
            case "create_tab":
              await openFileInNewTab(windowLabel, path);
              break;
            case "replace_tab":
              // Replace the clean untitled tab with the file content (only once)
              try {
                const content = await readTextFile(path);
                useTabStore.getState().updateTabPath(decision.tabId, decision.filePath);
                useDocumentStore.getState().loadContent(
                  decision.tabId,
                  content,
                  decision.filePath,
                  detectLinebreaks(content)
                );
                await openWorkspaceWithConfig(decision.workspaceRoot);
                useRecentFilesStore.getState().addFile(path);
                replaceableTabUsed = true;
              } catch (error) {
                dragDropError("Failed to replace tab with file:", path, error);
                const filename = getFileName(path) || path;
                toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
              }
              break;
            case "open_workspace_in_new_window":
              try {
                await invoke("open_workspace_in_new_window", {
                  workspaceRoot: decision.workspaceRoot,
                  filePath: decision.filePath,
                });
              } catch (error) {
                dragDropError("Failed to open workspace in new window:", path, error);
                const filename = getFileName(path) || path;
                toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
              }
              break;
            case "no_op":
              break;
          }
        }
      });

      if (cancelled) {
        safeUnlisten(unlisten);
        return;
      }

      unlistenRef.current = unlisten;
    };

    setupDragDrop().catch((error) => {
      dragDropError("Failed to setup drag-drop listeners:", error);
    });

    return () => {
      cancelled = true;
      safeUnlisten(unlistenRef.current);
      unlistenRef.current = null;
    };
  }, [windowLabel]);
}
