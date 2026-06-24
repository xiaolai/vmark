import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import {
  filterSupportedPaths,
  isSupportedFileName,
} from "@/utils/dropPaths";
import { resolveOpenAction, resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { dragDropError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { useFileLoadStore } from "@/stores/documentStore";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";
import { openDroppedFileInNewTab } from "@/hooks/dragDropOpenFile";
import { openDroppedPathsInLegacyWindows } from "@/hooks/dragDropLegacyWindows";

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

        if (type === "enter") {
          // WI-1B.2 — accept any registered extension on drag-enter so
          // the drop overlay shows for .json/.yaml/.toml/etc. as well.
          const paths = event.payload.paths;
          const hasSupported = paths.some((p: string) =>
            isSupportedFileName(p),
          );
          if (hasSupported) {
            useUIStore.getState().setDraggingFiles(true);
          }
          return;
        }

        if (type === "over") {
          return;
        }

        if (type === "leave") {
          useUIStore.getState().setDraggingFiles(false);
          return;
        }

        if (type !== "drop") return;

        useUIStore.getState().setDraggingFiles(false);

        const paths = event.payload.paths;
        // WI-1B.2 — drop accepts any registered format. The legacy
        // markdownPaths variable name is kept (it's used by the
        // downstream replacement pipeline) but the filter is broader.
        const markdownPaths = filterSupportedPaths(paths);
        if (markdownPaths.length === 0) {
          if (paths.length > 0) {
            toast.info(i18n.t("dialog:toast.unsupportedFileViaDropDrop"));
          }
          return;
        }

        const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
        const workspaceRailMode = useSettingsStore.getState().general.workspaceRailMode;
        const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
        const hasDirtyTabs = tabs.some((tab) => {
          const doc = useDocumentStore.getState().getDocument(tab.id);
          return doc?.isDirty;
        });

        const initialReplaceableTab = getReplaceableTab(windowLabel);
        let replaceableTabUsed = false;

        if (!workspaceRailMode && !isWorkspaceMode && hasDirtyTabs) {
          await openDroppedPathsInLegacyWindows(markdownPaths);
          return;
        }

        // If not in workspace mode, and all dropped files share the same root,
        // open that workspace in the current window and load as tabs.
        if (!workspaceRailMode && !isWorkspaceMode) {
          const roots = markdownPaths
            .map((path) => resolveWorkspaceRootForExternalFile(path))
            .filter((root): root is string => Boolean(root));
          const uniqueRoots = new Set(roots);

          if (uniqueRoots.size === 1) {
            const [batchRoot] = uniqueRoots;
            await openWorkspaceWithConfig(batchRoot, { windowLabel });

            for (const path of markdownPaths) {
              if (!replaceableTabUsed && initialReplaceableTab) {
                const route = await routeOpenBySize(path);
                if (!route.proceed) {
                  // Refused / cancelled — skip this file, continue batch.
                  continue;
                }

                const showIndicator =
                  !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
                let batchLoadId: number | null = null;
                if (showIndicator) {
                  batchLoadId = useFileLoadStore
                    .getState()
                    .startLoad(getFileName(path) || path, route.sizeBytes);
                }

                try {
                  const content = await readTextFile(path);
                  useTabStore.getState().updateTabPath(initialReplaceableTab.tabId, path);
                  useDocumentStore.getState().loadContent(
                    initialReplaceableTab.tabId,
                    content,
                    path,
                    detectLinebreaks(content)
                  );
                  applyFileOwnershipAfterOpen(initialReplaceableTab.tabId, path);
                  useRecentFilesStore.getState().addFile(path);
                  maybeMarkLargeMarkdownAsSource(
                    initialReplaceableTab.tabId,
                    path,
                    route.forceSourceMode,
                  );
                  replaceableTabUsed = true;
                  continue;
                } catch (error) {
                  dragDropError("Failed to replace tab with file:", path, error);
                  const filename = getFileName(path) || path;
                  toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
                  if (batchLoadId !== null) {
                    useFileLoadStore.getState().endLoad(batchLoadId);
                  }
                }
              }

              await openDroppedFileInNewTab(windowLabel, path);
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
            workspaceRailMode,
          });

          switch (decision.action) {
            case "activate_tab":
              useTabStore.getState().setActiveTab(windowLabel, decision.tabId);
              break;
            case "create_tab":
              await openDroppedFileInNewTab(windowLabel, path);
              break;
            case "replace_tab": {
              // Replace the clean untitled tab with the file content (only once).
              const route = await routeOpenBySize(path);
              if (!route.proceed) break;

              const showIndicator =
                !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
              let decisionLoadId: number | null = null;
              if (showIndicator) {
                decisionLoadId = useFileLoadStore
                  .getState()
                  .startLoad(getFileName(path) || path, route.sizeBytes);
              }

              try {
                const content = await readTextFile(path);
                useTabStore.getState().updateTabPath(decision.tabId, decision.filePath);
                useDocumentStore.getState().loadContent(
                  decision.tabId,
                  content,
                  decision.filePath,
                  detectLinebreaks(content)
                );
                if (decision.workspaceRoot) {
                  await openWorkspaceWithConfig(decision.workspaceRoot, { windowLabel });
                }
                applyFileOwnershipAfterOpen(decision.tabId, decision.filePath);
                useRecentFilesStore.getState().addFile(path);
                maybeMarkLargeMarkdownAsSource(
                  decision.tabId,
                  path,
                  route.forceSourceMode,
                );
                replaceableTabUsed = true;
              } catch (error) {
                dragDropError("Failed to replace tab with file:", path, error);
                const filename = getFileName(path) || path;
                toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
                if (decisionLoadId !== null) {
                  useFileLoadStore.getState().endLoad(decisionLoadId);
                }
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

/** Test-only exports — do NOT import in production code. */
export const __testing__ = {
  openFileInNewTab: openDroppedFileInNewTab,
};
