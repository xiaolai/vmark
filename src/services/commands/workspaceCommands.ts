/**
 * Workspace commands — ADR-012 migration of useWorkspaceMenuEvents.
 *
 * Two commands: open a workspace folder (with dirty-tab handling and
 * tab restoration), close the current workspace.
 */

import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { registerCommand } from "./CommandBus";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { workspaceWarn, workspaceError } from "@/utils/debug";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerWorkspaceCommands(): void {
  if (registered) return;

  registerCommand({
    id: "workspace.openFolder",
    title: () => i18n.t("commands:workspace.openFolder"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          canCreateDirectories: true,
          title: "Open Workspace Folder",
        });
        if (!selected) return;
        const path = typeof selected === "string" ? selected : selected[0];
        if (!path) return;

        const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
        const dirtyTabs = tabs.filter((tab) => {
          const doc = useDocumentStore.getState().getDocument(tab.id);
          return doc?.isDirty;
        });

        if (dirtyTabs.length > 0) {
          const confirmed = await ask(
            i18n.t("dialog:unsavedChanges.openInNewWindow"),
            {
              title: i18n.t("dialog:unsavedChanges.title"),
              kind: "warning",
              okLabel: i18n.t("dialog:unsavedChanges.openInNewWindowOk"),
              cancelLabel: i18n.t("dialog:unsavedChanges.openInNewWindowCancel"),
            }
          );
          if (confirmed) {
            await invoke("open_workspace_in_new_window", {
              workspaceRoot: path,
              filePath: null,
            });
          }
          return;
        }

        const existing = await openWorkspaceWithConfig(path);
        useUIStore.getState().showSidebarWithView("files");
        useRecentWorkspacesStore.getState().addWorkspace(path);

        if (existing?.lastOpenTabs && existing.lastOpenTabs.length > 0) {
          for (const filePath of existing.lastOpenTabs) {
            try {
              const content = await readTextFile(filePath);
              const tabId = useTabStore.getState().createTab(windowLabel, filePath);
              useDocumentStore.getState().initDocument(tabId, content, filePath);
              useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
            } catch {
              workspaceWarn(`Could not restore tab: ${filePath}`);
            }
          }
        }
      } catch (error) {
        workspaceError("Failed to open folder:", error);
      }
    },
  });

  registerCommand({
    id: "workspace.close",
    title: () => i18n.t("commands:workspace.close"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      await persistWorkspaceSession(windowLabel);
      useWorkspaceStore.getState().closeWorkspace();
    },
  });

  registered = true;
}
