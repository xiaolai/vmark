import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import {
  filterSupportedPaths,
  isSupportedFileName,
} from "@/utils/dropPaths";
import { resolveOpenAction, resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { replaceTabWithFile, type ReplaceTabResult } from "@/hooks/useFileOpen";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { dragDropError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";
import { openDroppedFileInNewTab } from "@/hooks/dragDropOpenFile";
import { openDroppedPathsInLegacyWindows } from "@/hooks/dragDropLegacyWindows";

/** Surface a drag-drop replace-tab read failure (cancellations stay silent). */
function reportReplaceFailure(result: ReplaceTabResult, path: string): void {
  if (result.ok || result.cancelled) return;
  dragDropError("Failed to replace tab with file:", path, result.error);
  const filename = getFileName(path) || path;
  toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
}

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
                // Reuse the shared replace pipeline (size route → indicator →
                // read → load → ownership → recents → large-file marking) which
                // also re-checks the target tab survived the read.
                const result = await replaceTabWithFile({
                  windowLabel,
                  tabId: initialReplaceableTab.tabId,
                  targetPath: path,
                  sourcePath: path,
                });
                if (result.ok) {
                  replaceableTabUsed = true;
                  continue;
                }
                // Cancelled (refused size route / tab closed mid-read) — skip
                // this file; a genuine error is surfaced before falling through.
                if (result.cancelled) continue;
                reportReplaceFailure(result, path);
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
              // Replace the clean untitled tab with the file content (only once)
              // via the shared pipeline, which guards against the tab being
              // closed during the async read.
              const result = await replaceTabWithFile({
                windowLabel,
                tabId: decision.tabId,
                targetPath: decision.filePath,
                sourcePath: path,
                workspaceRoot: decision.workspaceRoot,
              });
              if (result.ok) {
                replaceableTabUsed = true;
              } else {
                reportReplaceFailure(result, path);
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
