/**
 * Recent-files commands — ADR-012 migration of useRecentFilesMenuEvents.
 *
 * Two commands: clear-recent-files and open-recent-file (with full
 * resolveOpenAction routing: activate / create / replace / new window).
 *
 * The open-recent branches are extracted into small, individually testable
 * helpers (parseRecentFileArgs / openRecentInNewTab / replaceTabWithRecentFile
 * / openRecentInNewWindow) so the high-complexity command callback stays a thin
 * dispatcher and the replace flow reuses the same code path as Cmd+O.
 */

import { ask } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { hasCommand, registerCommand } from "./CommandBus";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { getReplaceableTab } from "@/hooks/useReplaceableTab";
import { openFileInNewTabCore, replaceTabWithFile } from "@/hooks/useFileOpen";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { menuError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";
import { parseRecentPathArgs } from "./recentPathArgs";

type Ctx = { windowLabel?: string };

/**
 * Normalize a recent-file command argument to a non-empty path string.
 * Thin alias over the shared recent-path parser (also used by
 * `workspace.openRecent`).
 */
export function parseRecentFileArgs(args: unknown): string | null {
  return parseRecentPathArgs(args);
}

/**
 * Prompt to remove a recent file that could not be opened. Used by the
 * create/replace paths when the underlying file is missing or unreadable.
 */
async function promptRemoveRecentFile(filePath: string): Promise<void> {
  const remove = await ask(i18n.t("dialog:fileNotFound.message"), {
    title: i18n.t("dialog:fileNotFound.title"),
    kind: "warning",
  });
  if (remove) {
    useRecentFilesStore.getState().removeFile(filePath);
  }
}

/**
 * Open a recent file in a new tab. Preflights existence so that a missing file
 * is offered for removal from the recents list — `openFileInNewTabCore` swallows
 * read failures internally (toast + tab cleanup), so without the preflight a
 * stale recent entry would silently survive a failed open.
 */
export async function openRecentInNewTab(
  windowLabel: string,
  filePath: string,
): Promise<void> {
  if (!(await exists(filePath))) {
    await promptRemoveRecentFile(filePath);
    return;
  }
  await openFileInNewTabCore(windowLabel, filePath);
}

/**
 * Replace a clean tab with a recent file. Reuses the shared replace flow so
 * Open and Open Recent can't drift, and offers removal from recents on failure.
 */
export async function replaceTabWithRecentFile(params: {
  windowLabel: string;
  tabId: string;
  targetPath: string;
  sourcePath: string;
  workspaceRoot?: string | null;
}): Promise<void> {
  const result = await replaceTabWithFile(params);
  if (result.ok || result.cancelled) return;
  menuError("Failed to replace tab with recent file:", result.error);
  await promptRemoveRecentFile(params.sourcePath);
}

/**
 * Open an external recent file's resolved workspace before creating its tab
 * (#946 parity with Cmd+O's `openWorkspaceForNewTab`): the new tab must be
 * claimed by the file's own workspace, not attached to the current context.
 * Failure is logged but non-fatal — the file still opens.
 */
async function openRecentWorkspaceForNewTab(
  windowLabel: string,
  workspaceRoot: string | null | undefined,
): Promise<void> {
  if (!workspaceRoot) return;
  try {
    await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
  } catch (error) {
    menuError("Failed to open workspace for recent file tab:", error);
  }
}

/** Open a recent file's workspace in a new window, with localized failure toast. */
export async function openRecentInNewWindow(
  workspaceRoot: string | null | undefined,
  filePath: string,
): Promise<void> {
  try {
    await invoke("open_workspace_in_new_window", { workspaceRoot, filePath });
  } catch (error) {
    menuError("Failed to open workspace in new window:", error);
    const filename = getFileName(filePath) || filePath;
    toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
  }
}

let registered = false;
export function registerRecentFilesCommands(): void {
  // HMR: the module-local flag resets on reload, but the bus registry survives.
  if (registered || hasCommand("file.clearRecent")) return;

  registerCommand({
    id: "file.clearRecent",
    title: () => i18n.t("commands:file.clearRecent"),
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
    title: () => i18n.t("commands:file.openRecent"),
    category: "file",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const filePath = parseRecentFileArgs(args);
      if (!filePath) return;

      const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
      // fix(#946) — honor the "open files in a new tab" preference, same as Cmd+O.
      const { openInNewTab, workspaceRailMode } = useSettingsStore.getState().general;
      const existingTab = useTabStore.getState().findTabByPath(windowLabel, filePath);
      const replaceableTab = getReplaceableTab(windowLabel);

      const result = resolveOpenAction({
        filePath,
        workspaceRoot: rootPath,
        isWorkspaceMode,
        existingTabId: existingTab?.id ?? null,
        replaceableTab,
        openInNewTab,
        workspaceRailMode,
      });

      await withReentryGuard(windowLabel, "open-recent", async () => {
        switch (result.action) {
          case "activate_tab":
            useTabStore.getState().setActiveTab(windowLabel, result.tabId);
            break;

          case "create_tab":
            // An external file opened in a new tab carries its own resolved
            // root; claim that workspace first (mirrors Cmd+O's handleOpen).
            await openRecentWorkspaceForNewTab(windowLabel, result.workspaceRoot);
            await openRecentInNewTab(windowLabel, result.filePath);
            break;

          case "replace_tab":
            await replaceTabWithRecentFile({
              windowLabel,
              tabId: result.tabId,
              targetPath: result.filePath,
              sourcePath: filePath,
              workspaceRoot: result.workspaceRoot,
            });
            break;

          case "open_workspace_in_new_window":
            await openRecentInNewWindow(result.workspaceRoot, result.filePath);
            break;

          case "no_op":
            break;
        }
      });
    },
  });

  registered = true;
}

/** Test-only: clears the one-time registration guard so a fresh bus re-registers. */
export function __resetRecentFilesCommandsRegistration(): void {
  registered = false;
}
