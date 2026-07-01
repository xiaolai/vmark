/**
 * Recent-workspaces commands — ADR-012 migration of
 * useRecentWorkspacesMenuEvents.
 *
 * Two commands: clear the list, and open one (with dirty-tab handling
 * and tab restoration).
 */

import { exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/services/ime/imeToast";
import { registerCommand } from "./CommandBus";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { restoreWorkspaceTabs, restoreSplitLayout } from "@/services/navigation/restoreWorkspaceTabs";
import i18n from "@/i18n";
import { workspaceError } from "@/utils/debug";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerRecentWorkspacesCommands(): void {
  if (registered) return;

  registerCommand({
    id: "workspace.clearRecent",
    title: () => i18n.t("commands:workspace.clearRecent"),
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
    title: () => i18n.t("commands:workspace.openRecent"),
    category: "workspace",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      // args may be either the tuple [path, label] (menu dispatch) or a
      // plain path string (programmatic call). Reject anything that doesn't
      // resolve to a non-empty string so `[]`/null/undefined can't become
      // literal "undefined"/"null" workspace paths.
      const candidate = Array.isArray(args) ? args[0] : args;
      if (typeof candidate !== "string" || candidate.length === 0) return;
      const workspacePath = candidate;

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
            try {
              await invoke("open_workspace_in_new_window", {
                workspaceRoot: workspacePath,
                filePath: null,
              });
            } catch (error) {
              // IPC failure must surface to the user, not reject the command
              // silently — matches the localized feedback other paths use.
              workspaceError("Failed to open workspace in new window:", error);
              toast.error(i18n.t("dialog:toast.openWorkspaceInNewWindowFailed"));
            }
          }
          return;
        }

        const existing = await openWorkspaceWithConfig(workspacePath, { windowLabel });
        useUIStore.getState().showSidebarWithView("files");

        // Shared restore loop with dedup guard — skips already-open tabs.
        await restoreWorkspaceTabs(windowLabel, existing?.lastOpenTabs);
        restoreSplitLayout(windowLabel, workspacePath);

        useRecentWorkspacesStore.getState().addWorkspace(workspacePath);
      });
    },
  });

  registered = true;
}

/** Test-only: clears the one-time registration guard so a fresh bus re-registers. */
export function __resetRecentWorkspacesCommandsRegistration(): void {
  registered = false;
}
