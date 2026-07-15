/**
 * Workspace commands — ADR-012 migration of useWorkspaceMenuEvents.
 *
 * Two commands: open a workspace folder (with dirty-tab handling and
 * tab restoration), close the current workspace.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { hasCommand, registerCommand } from "./CommandBus";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { withReentryGuard } from "@/utils/reentryGuard";
import { restoreWorkspaceTabs, restoreSplitLayout } from "@/services/navigation/restoreWorkspaceTabs";
import { documentPathsForRestore } from "@/services/persistence/sessionTabs";
import { workspaceError } from "@/utils/debug";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

/**
 * The re-entry guard key shared by EVERY command that transitions the window's
 * workspace (open folder, open recent, close). One key per window, not one per
 * command: two workspace transitions that interleave restore tabs and split
 * layout into whichever workspace happens to land last, and a close racing an
 * open persists the session of a half-torn-down workspace.
 */
export const WORKSPACE_TRANSITION_GUARD = "workspace-transition";

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
      // Reentry guard: rapid repeated activation must not stack folder
      // pickers or race workspace restoration.
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
        try {
          const selected = await open({
            directory: true,
            multiple: false,
            canCreateDirectories: true,
            title: i18n.t("dialog:openWorkspaceFolder.title"),
          });
          if (!selected) return;
          const path = typeof selected === "string" ? selected : selected[0];
          if (!path) return;

          // Open the selected workspace in the CURRENT window. This is safe even
          // with unsaved changes — opening a workspace doesn't close existing tabs,
          // so dirty docs survive. (#1005: the old binary "Open in New Window?"
          // dialog had no current-window option and duplicated its title on Linux.)
          const existing = await openWorkspaceWithConfig(path, { windowLabel });
          useUIStore.getState().showSidebarWithView("files");
          useRecentWorkspacesStore.getState().addWorkspace(path);

          // Shared restore loop with dedup guard — skips files already open in
          // this window so an existing dirty tab is never re-init'd/overwritten.
          await restoreWorkspaceTabs(
            windowLabel,
            existing ? documentPathsForRestore(existing) : undefined,
          );
          restoreSplitLayout(windowLabel, path);
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
