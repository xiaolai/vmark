/**
 * Workspace commands — ADR-012 migration of useWorkspaceMenuEvents.
 *
 * Two commands: open a workspace folder (with dirty-tab handling and
 * tab restoration), close the current workspace.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { hasCommand, registerCommand } from "./CommandBus";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { persistWorkspaceSession } from "@/services/workspaces/workspaceSession";
import { withReentryGuard } from "@/utils/reentryGuard";
import {
  openWorkspaceByPath,
  WORKSPACE_TRANSITION_GUARD,
} from "@/services/workspaces/openWorkspaceByPath";
import { workspaceError } from "@/utils/debug";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

// The transition-guard key now lives with the shared helper; re-exported so
// existing importers (recentWorkspacesCommands, tests) keep their path.
export { WORKSPACE_TRANSITION_GUARD };

let registered = false;
export function registerWorkspaceCommands(): void {
  // HMR: the module-local flag resets on reload, but the bus registry survives.
  if (registered || hasCommand("workspace.openFolder")) return;

  registerCommand({
    id: "workspace.openFolder",
    title: () => i18n.t("commands:workspace.openFolder"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      // Reentry guard around the dialog AND the open sequence: rapid repeated
      // activation must not stack folder pickers or race workspace restoration.
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
        try {
          const selected = await open({
            directory: true,
            multiple: false,
            // #1252 — grant the whole tree, not just the top level. The dialog
            // plugin extends the fs scope with
            // `allow_directory(path, options.recursive)`, which pushes
            // `path/*` when false and `path/**` when true. Without this a
            // workspace's SUBDIRECTORIES are out of scope and every file in
            // them fails with `forbidden path: …`. It only shows up off the
            // home drive: capabilities/default.json covers `$HOME/**`,
            // `/Volumes/**`, `/mnt/**` and `/media/**`, which masks the gap on
            // macOS and Linux, while on Windows `$HOME` is `C:\Users\<name>`
            // and a workspace on `G:\` is covered by nothing.
            recursive: true,
            canCreateDirectories: true,
            title: i18n.t("dialog:openWorkspaceFolder.title"),
          });
          if (!selected) return;
          const path = typeof selected === "string" ? selected : selected[0];
          if (!path) return;
          // Shared sequence (also used by the open_workspace MCP handler).
          await openWorkspaceByPath(path, { windowLabel });
        } catch (error) {
          workspaceError("Failed to open folder:", error);
        }
      });
    },
  });

  registerCommand({
    id: "workspace.close",
    title: () => i18n.t("commands:workspace.close"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      // Same guard as the open commands: a second close must not start a
      // concurrent session write, and a close must not tear down a workspace
      // an open is still restoring into.
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
        await persistWorkspaceSession(windowLabel);
        useWorkspaceStore.getState().closeWorkspace();
      });
    },
  });

  registered = true;
}

/** Test-only: clears the one-time registration guard so a fresh bus re-registers. */
export function __resetWorkspaceCommandsRegistration(): void {
  registered = false;
}
