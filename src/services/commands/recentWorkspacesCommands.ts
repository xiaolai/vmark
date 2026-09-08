/**
 * Recent-workspaces commands — ADR-012 migration of
 * useRecentWorkspacesMenuEvents.
 *
 * Two commands: clear the list, and open one.
 *
 * What is LOCAL here is the decision: is this entry still a folder, and does
 * this window's unsaved work mean the workspace belongs in a new window? The
 * accepted in-window transition itself is `openWorkspaceByPath` (audit #938).
 * This file used to re-implement that sequence — config, sidebar, tab restore,
 * split restore, recents — and the copy was missing the original's top-level
 * error boundary, so a throw anywhere inside it escaped the command instead of
 * being logged and reported as "did not open".
 *
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — the shared transition
 * @module services/commands/recentWorkspacesCommands
 */

import { exists, stat } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import i18n from "@/i18n";
import { workspaceError } from "@/utils/debug";
import { parseRecentPathArgs } from "./recentPathArgs";
import {
  WORKSPACE_TRANSITION_GUARD,
  openWorkspaceByPath,
} from "@/services/workspaces/openWorkspaceByPath";
import { confirmAction } from "@/services/dialogs/confirmAction";

type Ctx = { windowLabel?: string };

/**
 * Is this recents entry still a FOLDER we could open?
 *
 * Two refusals the plain `exists()` could not make:
 *   - `exists()` is true for a regular FILE too (audit #937), and
 *     `openWorkspaceWithConfig` falls back to store defaults on ANY read
 *     failure — so a file standing where the folder used to be would have been
 *     installed as the workspace root, with the whole window in workspace mode
 *     over something that has no file tree. Reported as not-found, which is
 *     what it is: the FOLDER is gone.
 *   - A probe that could not RUN is NOT evidence the workspace is gone.
 *     Offering to remove a workspace that exists is the worse outcome, so
 *     continue and let the open surface any real failure.
 */
async function recentWorkspaceIsPresent(workspacePath: string): Promise<boolean> {
  try {
    if (!(await exists(workspacePath))) return false;
    return (await stat(workspacePath)).isDirectory;
  } catch (error) {
    workspaceError("Could not probe recent workspace:", error);
    return true;
  }
}

/**
 * Hand the workspace to a NEW window because this one holds unsaved work.
 * Returns nothing: the IPC failure is the user's to see, not the caller's to
 * branch on.
 */
async function openRecentWorkspaceInNewWindow(workspacePath: string): Promise<void> {
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

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const RECENT_WORKSPACES_COMMANDS_OWNER = "recent-workspaces-commands";

/** Build the recent-workspaces command specs (pure — no registration). */
function buildRecentWorkspacesCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [];
  const add = (command: CommandDefinition): void => void specs.push(command);

  add({
    id: "workspace.clearRecent",
    title: () => i18n.t("commands:workspace.clearRecent"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const { workspaces } = useRecentWorkspacesStore.getState();
      if (workspaces.length === 0) return;
      await withReentryGuard(windowLabel, "clear-recent-workspaces", async () => {
        const confirmed = await confirmAction({
          title: i18n.t("dialog:clearRecentWorkspaces.title"),
          message: i18n.t("dialog:clearRecentWorkspaces.message"),
          actionLabel: i18n.t("dialog:action.clear"),
          kind: "warning",
        });
        if (confirmed) {
          useRecentWorkspacesStore.getState().clearAll();
        }
      });
    },
  });

  add({
    id: "workspace.openRecent",
    title: () => i18n.t("commands:workspace.openRecent"),
    category: "workspace",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const workspacePath = parseRecentPathArgs(args);
      if (!workspacePath) return;

      // Shares the workspace-transition guard with workspace.openFolder /
      // workspace.close — a per-command key would let two workspace opens race.
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
        // #1252 / audit #936 — the fs-scope grant comes BEFORE the probe, the
        // same order `openWorkspaceByPath` uses. Grants are in-memory and do
        // not survive a restart, so a recents entry outside the static scope
        // (`G:\` on Windows, `/opt` on macOS) made `exists()` REJECT with
        // "forbidden path"; that rejection escaped the command and the menu
        // item did nothing at all, with no message. The transition grants
        // again — the grant is idempotent, and neither caller may assume the
        // other ran.
        await invoke("allow_workspace_access", { path: workspacePath }).catch((error) => {
          workspaceError("Failed to grant workspace fs scope:", error);
        });

        if (!(await recentWorkspaceIsPresent(workspacePath))) {
          const remove = await confirmAction({
            title: i18n.t("dialog:workspaceNotFound.title"),
            message: i18n.t("dialog:workspaceNotFound.message"),
            actionLabel: i18n.t("dialog:action.remove"),
            kind: "warning",
          });
          if (remove) {
            useRecentWorkspacesStore.getState().removeWorkspace(workspacePath);
          }
          return;
        }

        // Unsaved work stays where it is: the workspace opens in a new window
        // instead. This decision is the only part of the flow that is specific
        // to opening from RECENTS.
        const hasDirtyTabs = useTabStore
          .getState()
          .getTabsByWindow(windowLabel)
          .some((tab) => useDocumentStore.getState().getDocument(tab.id)?.isDirty);
        if (hasDirtyTabs) {
          const confirmed = await confirmAction({
            title: i18n.t("dialog:unsavedChanges.title"),
            message: i18n.t("dialog:unsavedChanges.openInNewWindow"),
            actionLabel: i18n.t("dialog:unsavedChanges.openInNewWindowOk"),
            kind: "warning",
            cancelLabel: i18n.t("dialog:unsavedChanges.openInNewWindowCancel"),
          });
          if (confirmed) await openRecentWorkspaceInNewWindow(workspacePath);
          return;
        }

        // The shared transition — config, sidebar, recents, tab restore, split
        // restore — under the guard this command already holds.
        await openWorkspaceByPath(workspacePath, { windowLabel });
      });
    },
  });

  return specs;
}

/**
 * Register both recent-workspace commands as ONE owner batch (audit #934).
 *
 * A `hasCommand("workspace.clearRecent")` sentinel suppressed
 * `workspace.openRecent` whenever that id was already taken, and gave no
 * atomicity of its own outside the bootstrap transaction.
 */
export function registerRecentWorkspacesCommands(): void {
  registerCommands(RECENT_WORKSPACES_COMMANDS_OWNER, buildRecentWorkspacesCommandSpecs());
}
