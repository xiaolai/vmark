/**
 * Workspace commands — ADR-012 migration of useWorkspaceMenuEvents.
 *
 * Two commands: open a workspace folder (with dirty-tab handling and
 * tab restoration), close the current workspace. Each is a named handler
 * below; `registerWorkspaceCommands` only registers them, as ONE owner-based
 * batch (audit #463/#464) — a reload replaces this owner's batch, and an
 * identically named command from another registrar is refused rather than
 * taken for "already registered" by a first-command sentinel.
 *
 * Close has two shapes. With the workspace rail OFF it is the legacy close:
 * persist the session, null the workspace store, keep the tabs. With the rail
 * ON the workspace is an INSTANCE on the rail, and closing it means what the
 * rail's own Close means (`closeWorkspaceInstance`): its tabs go through the
 * dirty check, the instance is removed, a successor is promoted and hydrated.
 * Running only the legacy close under the rail left the instance registered
 * and ACTIVE with no root — the status-bar tab strip is scoped to the active
 * instance, so it had nothing to show and unmounted, and every new untitled
 * tab was claimed into the inactive "Loose Files", invisible until the user
 * happened to click that rail entry. Observed live 2026-09-07.
 *
 * @coordinates-with services/workspaces/closeWorkspaceInstance.ts — the rail-on close
 * @coordinates-with components/WorkspaceRail/workspaceRailHandlers.ts — the rail's own Close, same path
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — the shared open sequence and its guard key
 */

import { open } from "@tauri-apps/plugin-dialog";
import { registerCommands } from "./CommandBus";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  selectActiveWorkspaceInstance,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { closeWorkspaceInstance } from "@/services/workspaces/closeWorkspaceInstance";
import { persistWorkspaceSession } from "@/services/workspaces/workspaceSession";
import { closeTabsWithDirtyCheck } from "@/services/tabs/tabOperations";
import { imeToast as toast } from "@/services/ime/imeToast";
import { withReentryGuard } from "@/utils/reentryGuard";
import {
  openWorkspaceByPath,
  WORKSPACE_TRANSITION_GUARD,
} from "@/services/workspaces/openWorkspaceByPath";
import { workspaceError } from "@/utils/debug";
import { reportCommandFailure } from "./commandFailure";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

/** Owner token the workspace commands register under (HMR-safe, replace-own). */
const WORKSPACE_COMMANDS_OWNER = "workspace-commands";

/**
 * The railed workspace instance File → Close Workspace should close, or null
 * when the legacy close applies: rail off, or the window's active instance is
 * not a workspace (loose files and the placeholder have no root to close).
 */
function activeRailWorkspaceInstanceId(windowLabel: string): string | null {
  if (!isWorkspaceRailEnabled()) return null;
  const active = selectActiveWorkspaceInstance(
    useWorkspaceInstancesStore.getState(),
    windowLabel,
  );
  return active?.kind === "workspace" ? active.workspaceInstanceId : null;
}

/**
 * The folder picker's options — a CONFIGURATION, not control flow (audit #951).
 *
 * `recursive: true` is the load-bearing one (#1252): grant the whole tree, not
 * just the top level. The dialog plugin extends the fs scope with
 * `allow_directory(path, options.recursive)`, which pushes `path/*` when false
 * and `path/**` when true. Without it a workspace's SUBDIRECTORIES are out of
 * scope and every file in them fails with `forbidden path: …`. It only shows up
 * off the home drive: capabilities/default.json covers `$HOME/**`,
 * `/Volumes/**`, `/mnt/**` and `/media/**`, which masks the gap on macOS and
 * Linux, while on Windows `$HOME` is `C:\Users\<name>` and a workspace on
 * `G:\` is covered by nothing.
 *
 * A function, not a constant: the title is resolved through i18n at call time,
 * so it follows a language change.
 */
function workspacePickerOptions(): Parameters<typeof open>[0] {
  return {
    directory: true,
    multiple: false,
    recursive: true,
    canCreateDirectories: true,
    title: i18n.t("dialog:openWorkspaceFolder.title"),
  };
}

/** File → Open Workspace: pick a folder, then run the shared open sequence. */
async function openWorkspaceFolder(windowLabel: string): Promise<void> {
  // Reentry guard around the dialog AND the open sequence: rapid repeated
  // activation must not stack folder pickers or race workspace restoration.
  await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
    try {
      const selected = await open(workspacePickerOptions());
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected[0];
      if (!path) return;
      // Shared sequence (also used by the open_workspace MCP handler).
      await openWorkspaceByPath(path, { windowLabel });
    } catch (error) {
      workspaceError("Failed to open folder:", error);
    }
  });
}

/** File → Close Workspace: persist the session, then the rail-aware close. */
async function closeCurrentWorkspace(windowLabel: string): Promise<void> {
  // Same guard as the open commands: a second close must not start a
  // concurrent session write, and a close must not tear down a workspace
  // an open is still restoring into.
  await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
    // CONTAINED and reported (audit #953), like the open command beside it. A
    // session write that fails, a dirty-close that throws, a rail finalization
    // that rejects — all of them used to escape into the command bus, where the
    // menu route logs a line nobody reads and the palette route drops the
    // rejection entirely. Cancellation is NOT an exception here: a user
    // declining at the dirty prompt comes back as `result.reason`, so
    // containing the throw does not swallow it.
    try {
      // Resolve the TARGET before the first await (audit #954). The user asked to
      // close the workspace that was active when they invoked the command;
      // reading it after `persistWorkspaceSession` awaited let a rail click in
      // that window pick a different instance and close THAT one instead. A
      // target that has gone since is reported `missing` below, which is silent.
      const railed = activeRailWorkspaceInstanceId(windowLabel);
      await persistWorkspaceSession(windowLabel);
      if (railed) {
        // The rail's own Close: dirty-checked tab closes, instance removal,
        // successor promotion + hydration (which nulls the legacy store for a
        // rootless successor). `cancelled` is the user's answer at a dirty
        // prompt and `missing` means it is already gone — silent, as on the
        // rail; only `busy` is worth a word.
        const result = await closeWorkspaceInstance(windowLabel, railed, {
          closeTabs: closeTabsWithDirtyCheck,
        });
        if (!result.ok && result.reason === "busy") {
          toast.error(i18n.t("dialog:toast.workspaceCloseBusy"));
        }
        return;
      }
      useWorkspaceStore.getState().closeWorkspace();
    } catch (error) {
      reportCommandFailure(error, {
        label: "Failed to close the workspace:",
        log: workspaceError,
      });
    }
  });
}

export function registerWorkspaceCommands(): void {
  registerCommands(WORKSPACE_COMMANDS_OWNER, [
    {
      id: "workspace.openFolder",
      title: () => i18n.t("commands:workspace.openFolder"),
      category: "workspace",
      run: (_args, ctx: Ctx) => openWorkspaceFolder(ctx.windowLabel ?? "main"),
    },
    {
      id: "workspace.close",
      title: () => i18n.t("commands:workspace.close"),
      category: "workspace",
      run: (_args, ctx: Ctx) => closeCurrentWorkspace(ctx.windowLabel ?? "main"),
    },
  ]);
}

/**
 * Test-only. Owner-based registration is replace-own, so there is no
 * one-time guard left to clear; kept so callers that reset between fresh
 * buses need no change.
 */
export function __resetWorkspaceCommandsRegistration(): void {}
