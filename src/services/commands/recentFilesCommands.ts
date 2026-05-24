/**
 * Recent-files commands — ADR-012 migration of useRecentFilesMenuEvents.
 *
 * Two commands: clear-recent-files and open-recent-file (with full
 * resolveOpenAction routing: activate / create / replace / new window).
 */

import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { registerCommand } from "./CommandBus";
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
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { menuError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerRecentFilesCommands(): void {
  if (registered) return;

  registerCommand({
    id: "file.clearRecent",
    title: "Clear Recent Files",
    category: "file",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
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
    },
  });

  registerCommand({
    id: "file.openRecent",
    title: "Open Recent File",
    category: "file",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      // args may be either the tuple [path, label] (menu dispatch) or a
      // plain path string (programmatic call).
      let filePath: string;
      if (Array.isArray(args)) {
        filePath = String(args[0]);
      } else if (typeof args === "string") {
        filePath = args;
      } else {
        return;
      }

      const { files } = useRecentFilesStore.getState();
      const file = files.find((f) => f.path === filePath) ?? { path: filePath };
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
            const route = await routeOpenBySize(file.path);
            if (!route.proceed) break;

            const showIndicator =
              !route.forceSourceMode &&
              shouldShowProgressIndicator(route.sizeBytes);
            let replaceLoadId: number | null = null;
            if (showIndicator) {
              const filename = getFileName(file.path) || file.path;
              replaceLoadId = useFileLoadStore.getState().startLoad(filename, route.sizeBytes);
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
              const remove = await ask(
                i18n.t("dialog:fileNotFound.message"),
                { title: i18n.t("dialog:fileNotFound.title"), kind: "warning" }
              );
              if (remove) {
                useRecentFilesStore.getState().removeFile(file.path);
              }
            } finally {
              // Ensure the progress indicator clears whether the load
              // succeeded or failed — drops the orphan-indicator finding.
              if (replaceLoadId !== null) {
                useFileLoadStore.getState().endLoad(replaceLoadId);
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
    },
  });

  registered = true;
}
