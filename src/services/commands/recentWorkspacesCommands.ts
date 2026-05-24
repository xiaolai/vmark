/**
 * Recent-workspaces commands — ADR-012 migration of
 * useRecentWorkspacesMenuEvents.
 *
 * Two commands: clear the list, and open one (with dirty-tab handling
 * and tab restoration).
 */

import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { registerCommand } from "./CommandBus";
import { useRecentWorkspacesStore } from "@/stores/recentWorkspacesStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import i18n from "@/i18n";
import { workspaceWarn } from "@/utils/debug";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerRecentWorkspacesCommands(): void {
  if (registered) return;

  registerCommand({
    id: "workspace.clearRecent",
    title: "Clear Recent Workspaces",
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const { workspaces } = useRecentWorkspacesStore.getState();
      if (workspaces.length === 0) return;
      await withReentryGuard(windowLabel, "clear-recent-workspaces", async () => {
        const confirmed = await ask(
          i18n.t("dialog:clearRecentWorkspaces.message"),
          {
            title: i18n.t("dialog:clearRecentWorkspaces.title"),
            kind: "warning",
          }
        );
        if (confirmed) {
          useRecentWorkspacesStore.getState().clearAll();
        }
      });
    },
  });

  registerCommand({
    id: "workspace.openRecent",
    title: "Open Recent Workspace",
    category: "workspace",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      // args may be either the tuple [path, label] (menu dispatch) or a
      // plain path string (programmatic call).
      let workspacePath: string;
      if (Array.isArray(args)) {
        workspacePath = String(args[0]);
      } else if (typeof args === "string") {
        workspacePath = args;
      } else {
        return;
      }

      await withReentryGuard(windowLabel, "open-recent-workspace", async () => {
        const pathExists = await exists(workspacePath);
        if (!pathExists) {
          const remove = await ask(
            i18n.t("dialog:workspaceNotFound.message"),
            { title: i18n.t("dialog:workspaceNotFound.title"), kind: "warning" }
          );
          if (remove) {
            useRecentWorkspacesStore.getState().removeWorkspace(workspacePath);
          }
          return;
        }

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
              workspaceRoot: workspacePath,
              filePath: null,
            });
          }
          return;
        }

        const existing = await openWorkspaceWithConfig(workspacePath);
        useUIStore.getState().showSidebarWithView("files");

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

        useRecentWorkspacesStore.getState().addWorkspace(workspacePath);
      });
    },
  });

  registered = true;
}
