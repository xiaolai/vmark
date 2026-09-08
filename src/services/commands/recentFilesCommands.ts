/**
 * Recent-files commands — ADR-012 migration of useRecentFilesMenuEvents.
 *
 * Two commands: clear-recent-files and open-recent-file.
 *
 * The open path is a PREFLIGHT plus the shared open-decision executor (audit
 * #930). It used to be a five-way dispatcher of its own, and the copy had
 * already drifted from `executeOpenDecision` in two ways that reached users:
 * it activated with a plain `setActiveTab`, leaving the sidebar on a different
 * workspace from the document it had just shown (#931), and it swallowed a
 * failed workspace claim into a log line, so the file opened under the previous
 * context with nothing on screen to say so (#932).
 *
 * What is genuinely recents-specific is the ONE question the executor cannot
 * ask: is this entry still openable? That is asked once, before routing (#928),
 * for every action that names the file on disk — so the new-window route offers
 * removal like the others instead of leaving a dead entry forever. Asking it up
 * front also retires the old per-branch guesswork: a replace that failed for any
 * reason at all used to be reported as "file not found" and offered for removal,
 * although ingestion, ownership and workspace-switch failures land there too
 * (#927). Those are now the executor's error toast, which is what they are.
 *
 * @coordinates-with services/navigation/executeOpenDecision.ts — the shared executor
 * @coordinates-with utils/openPolicy.ts — resolveOpenAction produces the decision
 * @module services/commands/recentFilesCommands
 */

import { exists, stat } from "@tauri-apps/plugin-fs";
import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { getReplaceableTab, isWindowEmpty } from "@/services/tabs/replaceableTab";
import { openFileInNewTabCore } from "@/services/navigation/fileOpen";
import { executeOpenDecision } from "@/services/navigation/executeOpenDecision";
import { menuError } from "@/utils/debug";
import { parseRecentPathArgs } from "./recentPathArgs";
import { confirmAction } from "@/services/dialogs/confirmAction";
import type { OpenActionResult } from "@/utils/openPolicy/types";

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
 * preflight when the underlying file is gone.
 */
async function promptRemoveRecentFile(filePath: string): Promise<void> {
  const remove = await confirmAction({
    title: i18n.t("dialog:fileNotFound.title"),
    message: i18n.t("dialog:fileNotFound.message"),
    actionLabel: i18n.t("dialog:action.remove"),
    kind: "warning",
  });
  if (remove) {
    useRecentFilesStore.getState().removeFile(filePath);
  }
}

/**
 * Is this recents entry still a file we could open? (audit #926)
 *
 * Three things this has to get right, and the old `await exists(path)` got none
 * of them:
 *
 *   - **A rejection is not an answer.** `exists()` REJECTS with "forbidden
 *     path" for a path outside the fs scope, and that rejection escaped the
 *     command — the menu item did nothing at all, with no message. Same defect
 *     `recentWorkspacesCommands` fixed for folders (#1252 / audit #936).
 *   - **A probe that could not RUN is not evidence of absence.** Offering to
 *     remove a file that exists is the worse outcome, so an unreadable probe
 *     says "present" and lets the open surface any real failure (audit #937's
 *     rule, applied to files).
 *   - **`exists()` is true for a DIRECTORY too.** A folder standing where the
 *     file used to be is reported as gone, which is what it is.
 */
async function recentFileIsPresent(filePath: string): Promise<boolean> {
  try {
    if (!(await exists(filePath))) return false;
    return (await stat(filePath)).isFile;
  } catch (error) {
    menuError("Could not probe recent file:", error);
    return true;
  }
}

/**
 * Whether carrying out `decision` will read `filePath` from disk.
 *
 * `activate_tab` reads an already-open tab — a file whose disk copy vanished
 * while its tab is open must still activate — and `no_op` reads nothing.
 * Everything else hands the path to a reader or to another window.
 */
function decisionNeedsTheFile(decision: OpenActionResult): boolean {
  return decision.action !== "activate_tab" && decision.action !== "no_op";
}

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const RECENT_FILES_COMMANDS_OWNER = "recent-files-commands";

/** Build the recent-files command specs (pure — no registration). */
function buildRecentFilesCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [];
  const add = (command: CommandDefinition): void => void specs.push(command);

  add({
    id: "file.clearRecent",
    title: () => i18n.t("commands:file.clearRecent"),
    category: "file",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const { files } = useRecentFilesStore.getState();
      if (files.length === 0) return;

      await withReentryGuard(windowLabel, "clear-recent", async () => {
        const confirmed = await confirmAction({
          title: i18n.t("dialog:clearRecentFiles.title"),
          message: i18n.t("dialog:clearRecentFiles.message"),
          actionLabel: i18n.t("dialog:action.clear"),
          kind: "warning",
        });
        if (confirmed) {
          useRecentFilesStore.getState().clearAll();
        }
      });
    },
  });

  add({
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
      // fix(#1331) — the Welcome screen's recent list runs this command, and a
      // window with zero tabs has no replaceable tab to offer.
      const windowIsEmpty = isWindowEmpty(windowLabel);

      const result = resolveOpenAction({
        filePath,
        workspaceRoot: rootPath,
        isWorkspaceMode,
        existingTabId: existingTab?.id ?? null,
        replaceableTab,
        openInNewTab,
        workspaceRailMode,
        windowIsEmpty,
      });

      await withReentryGuard(windowLabel, "open-recent", async () => {
        if (decisionNeedsTheFile(result) && !(await recentFileIsPresent(filePath))) {
          await promptRemoveRecentFile(filePath);
          return;
        }
        // `result.filePath` is never a transformed path — the policy threads the
        // caller's own string through every action — so this is the same value.
        //
        // The opener's `OpenOutcome` is deliberately NOT consulted: absence is
        // the preflight's question, and `"failed"` here means the read broke
        // AFTER the file was there (permission, encoding, a mid-flight delete),
        // which `openFileInNewTabCore` already reports and which is not grounds
        // to offer the entry for removal — that is exactly the misreport #927
        // names.
        await executeOpenDecision(windowLabel, filePath, result, async (label, path) => {
          await openFileInNewTabCore(label, path);
        });
      });
    },
  });

  return specs;
}

/**
 * Register both recent-file commands as ONE owner batch (audit #929).
 *
 * A `hasCommand("file.clearRecent")` sentinel silently skipped
 * `file.openRecent` whenever that first id was already registered, and offered
 * no atomicity for a standalone (non-bootstrap) call.
 */
export function registerRecentFilesCommands(): void {
  registerCommands(RECENT_FILES_COMMANDS_OWNER, buildRecentFilesCommandSpecs());
}
