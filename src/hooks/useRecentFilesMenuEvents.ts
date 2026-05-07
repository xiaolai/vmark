/**
 * Recent Files Menu Events Hook
 *
 * Purpose: Handles native menu events for the "Open Recent" submenu —
 *   opens a recently used file in a new tab or new window.
 *
 * Key decisions:
 *   - Uses resolveOpenAction to decide tab vs window
 *   - Prompts user if file no longer exists on disk
 *   - Clears recent files list on "clear-recent" event
 *
 * @coordinates-with recentFilesStore.ts — reads/clears recent files list
 * @coordinates-with openPolicy.ts — resolveOpenAction for routing decision
 * @module hooks/useRecentFilesMenuEvents
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useFileLoadStore } from "@/stores/fileLoadStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { getReplaceableTab } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { openFileInNewTabCore } from "@/hooks/useFileOpen";
import { routeOpenBySize } from "@/utils/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import { menuError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";

/** Hook that handles native menu events for the "Open Recent" file submenu. */
export function useRecentFilesMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Clear Recent Files
      const unlistenClearRecent = await currentWindow.listen<string>("menu:clear-recent", async (event) => {
        if (event.payload !== windowLabel) return;

        const { files } = useRecentFilesStore.getState();
        if (files.length === 0) return;

        await withReentryGuard(windowLabel, "clear-recent", async () => {
          const confirmed = await ask(
            i18n.t("dialog:clearRecentFiles.message"),
            {
              title: i18n.t("dialog:clearRecentFiles.title"),
              kind: "warning",
            }
          );
          if (confirmed) {
            useRecentFilesStore.getState().clearAll();
          }
        });
      });
      if (cancelled) { unlistenClearRecent(); return; }
      unlistenRefs.current.push(unlistenClearRecent);

      // Open Recent File - uses workspace boundary policy
      // Payload is now (path, windowLabel) - path from Rust snapshot prevents race conditions
      const unlistenOpenRecent = await currentWindow.listen<[string, string]>("menu:open-recent-file", async (event) => {
        const [filePath, targetLabel] = event.payload;
        if (targetLabel !== windowLabel) return;

        // Find file in store by path (or create minimal file object)
        const { files } = useRecentFilesStore.getState();
        const file = files.find(f => f.path === filePath) ?? { path: filePath };
        const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
        const existingTab = useTabStore.getState().findTabByPath(windowLabel, file.path);
        const replaceableTab = getReplaceableTab(windowLabel);

        const result = resolveOpenAction({
          filePath: file.path,
          workspaceRoot: rootPath,
          isWorkspaceMode,
          existingTabId: existingTab?.id ?? null,
          replaceableTab,
        });

        await withReentryGuard(windowLabel, "open-recent", async () => {
          switch (result.action) {
            case "activate_tab":
              useTabStore.getState().setActiveTab(windowLabel, result.tabId);
              break;

            case "create_tab":
              try {
                // Route through the shared open core so size-routing,
                // forced-source marking, and progress indication all apply.
                // openFileInNewTabCore handles refused / cancelled / huge
                // files identically to Cmd+O / drag-drop / Finder, and
                // already updates the recent-files store on success — no
                // duplicate addFile call needed here.
                await openFileInNewTabCore(windowLabel, file.path);
              } catch (error) {
                menuError("Failed to open recent file:", error);
                const remove = await ask(
                  i18n.t("dialog:fileNotFound.message"),
                  { title: i18n.t("dialog:fileNotFound.title"), kind: "warning" }
                );
                if (remove) {
                  useRecentFilesStore.getState().removeFile(file.path);
                }
              }
              break;

            case "replace_tab": {
              // Pre-read size gate so refused / cancelled / huge files
              // honor the large-file UX on the replace branch too.
              const route = await routeOpenBySize(file.path);
              if (!route.proceed) break;

              const showIndicator =
                !route.forceSourceMode &&
                shouldShowProgressIndicator(route.sizeBytes);
              let replaceLoadId: number | null = null;
              if (showIndicator) {
                const filename = getFileName(file.path) || file.path;
                replaceLoadId = useFileLoadStore
                  .getState()
                  .startLoad(filename, route.sizeBytes);
              }

              try {
                const content = await readTextFile(file.path);
                useTabStore.getState().updateTabPath(result.tabId, result.filePath);
                useDocumentStore.getState().loadContent(
                  result.tabId,
                  content,
                  result.filePath,
                  detectLinebreaks(content)
                );
                await openWorkspaceWithConfig(result.workspaceRoot);
                useRecentFilesStore.getState().addFile(file.path);

                maybeMarkLargeMarkdownAsSource(
                  result.tabId,
                  file.path,
                  route.forceSourceMode,
                );
              } catch (error) {
                menuError("Failed to replace tab with recent file:", error);
                if (replaceLoadId !== null) {
                  useFileLoadStore.getState().endLoad(replaceLoadId);
                }
                const remove = await ask(
                  i18n.t("dialog:fileNotFound.message"),
                  { title: i18n.t("dialog:fileNotFound.title"), kind: "warning" }
                );
                if (remove) {
                  useRecentFilesStore.getState().removeFile(file.path);
                }
              }
              break;
            }

            case "open_workspace_in_new_window":
              try {
                await invoke("open_workspace_in_new_window", {
                  workspaceRoot: result.workspaceRoot,
                  filePath: result.filePath,
                });
              } catch (error) {
                menuError("Failed to open workspace in new window:", error);
                const filename = getFileName(file.path) || file.path;
                toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
              }
              break;

            case "no_op":
              break;
          }
        });
      });
      if (cancelled) { unlistenOpenRecent(); return; }
      unlistenRefs.current.push(unlistenOpenRecent);
    };

    setupListeners().catch((error) => {
      menuError("Failed to setup recent files menu listeners:", error);
    });

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
