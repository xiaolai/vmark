/**
 * Hook for handling drag-and-drop file opening
 *
 * Listens to Tauri's drag-drop events and opens dropped markdown files.
 * Files within the current workspace open in new tabs; files outside
 * the workspace open in a new window with the file's folder as workspace.
 *
 * @module hooks/useDragDropOpen
 */
import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { filterMarkdownPaths } from "@/utils/dropPaths";
import { resolveOpenAction, resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";

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
    console.error("[DragDrop] Failed to open file:", path, error);
    const filename = path.split("/").pop() ?? path;
    toast.error(`Failed to open ${filename}`);
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

        // Only handle drop events (not hover/leave)
        if (event.payload.type !== "drop") return;

        const paths = event.payload.paths;
        const markdownPaths = filterMarkdownPaths(paths);
        if (markdownPaths.length === 0) {
          if (paths.length > 0) {
            toast.info("Only markdown files can be opened via drag-drop");
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
              console.error("[DragDrop] Failed to open workspace in new window:", error);
              toast.error("Failed to open files in new window");
            }
          }

          for (const path of rootless) {
            try {
              await invoke("open_file_in_new_window", { path });
            } catch (error) {
              console.error("[DragDrop] Failed to open file in new window:", error);
              const filename = path.split("/").pop() ?? path;
              toast.error(`Failed to open ${filename}`);
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
                  console.error("[DragDrop] Failed to replace tab with file:", path, error);
                  const filename = path.split("/").pop() ?? path;
                  toast.error(`Failed to open ${filename}`);
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
                console.error("[DragDrop] Failed to replace tab with file:", path, error);
                const filename = path.split("/").pop() ?? path;
                toast.error(`Failed to open ${filename}`);
              }
              break;
            case "open_workspace_in_new_window":
              try {
                await invoke("open_workspace_in_new_window", {
                  workspaceRoot: decision.workspaceRoot,
                  filePath: decision.filePath,
                });
              } catch (error) {
                console.error("[DragDrop] Failed to open workspace in new window:", path, error);
                const filename = path.split("/").pop() ?? path;
                toast.error(`Failed to open ${filename}`);
              }
              break;
            case "no_op":
              break;
          }
        }
      });

      if (cancelled) {
        unlisten();
        return;
      }

      unlistenRef.current = unlisten;
    };

    setupDragDrop();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [windowLabel]);
}
