/**
 * Misc commands — ADR-012 migration of useMenuEvents.
 *
 * Five unrelated domains share this registrar because they share a menu, not a
 * subject: app surfaces (preferences, palette, quick open), history clearing,
 * orphan-image cleanup, help links, and the Genies folder. Each has its OWN
 * spec builder below (audit #917) — the batch is their concatenation, so the
 * domains stay legible and independently readable, and they are still
 * registered as one atomic owner batch.
 *
 * Every contained failure here goes through `commandFailure.reportCommandFailure`:
 * a log line the user never sees is not a report (#921, #922).
 *
 * @coordinates-with services/commands/commandFailure.ts — the log-and-show policy
 * @module services/commands/miscCommands
 */

import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { clearAllHistory, clearWorkspaceHistory } from "@/services/history/historyRecovery";
import { historyLog, historyError } from "@/utils/debug";
import { emitHistoryCleared } from "@/utils/historyTypes";
import { withReentryGuard } from "@/utils/reentryGuard";
import { runOrphanCleanup } from "@/services/media/orphanCleanupPrompt";
import { liveContentsExcluding } from "@/services/media/liveDocumentContents";
import { openSettingsWindow } from "@/services/navigation/settingsWindow";
import { useCommandPaletteStore } from "@/stores/commandPaletteStore";
import { useQuickOpenStore } from "@/stores/quickOpenStore";
import { confirmAction } from "@/services/dialogs/confirmAction";
import { reportCommandFailure } from "./commandFailure";

/**
 * Open an external help link, REPORTING a refusal (audit #921).
 *
 * A throw out of a command body is caught by the menu dispatcher and written
 * to the log — a surface nobody reads mid-session — and the palette route
 * drops it entirely. So an `openUrl` the opener plugin refuses (a scheme
 * outside the capability, no registered handler) left the click doing
 * nothing at all, with no way for the user to tell it from a slow browser.
 */
async function openHelpLink(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (error) {
    reportCommandFailure(error, { label: `Failed to open help link (${url}):` });
  }
}

const HELP_URL = "https://vmark.app/guide/";
const SHORTCUTS_URL = "https://vmark.app/guide/shortcuts";
const REPORT_ISSUE_URL = "https://github.com/xiaolai/vmark/issues/new";

type Ctx = { windowLabel?: string };

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const MISC_COMMANDS_OWNER = "misc-commands";

/** App-level surfaces: settings window, command palette, quick open. */
function appCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "app.preferences",
      title: () => i18n.t("commands:app.preferences"),
      category: "app",
      run: async () => {
        await openSettingsWindow();
      },
    },
    {
      id: "app.commandPalette",
      title: () => i18n.t("commands:app.commandPalette"),
      category: "app",
      run: () => useCommandPaletteStore.getState().toggle(),
    },
    {
      id: "app.quickOpen",
      title: () => i18n.t("commands:app.quickOpen"),
      category: "app",
      run: () => useQuickOpenStore.getState().toggle(),
    },
  ];
}

/** Destructive history clearing — confirmed, re-entry-guarded, per scope. */
function historyCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "history.clearAll",
      title: () => i18n.t("commands:history.clearAll"),
      category: "history",
      run: async (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        await withReentryGuard(windowLabel, "clear-history", async () => {
          const confirmed = await confirmAction({
            title: i18n.t("dialog:clearHistory.allTitle"),
            message: i18n.t("dialog:clearHistory.allMessage"),
            actionLabel: i18n.t("dialog:action.clearHistory"),
            kind: "warning",
          });
          if (confirmed) {
            try {
              await clearAllHistory();
              historyLog("All history cleared");
              emitHistoryCleared();
            } catch (error) {
              historyError("Failed to clear history:", error);
            }
          }
        });
      },
    },
    {
      id: "history.clearWorkspace",
      title: () => i18n.t("commands:history.clearWorkspace"),
      category: "history",
      run: async (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        await withReentryGuard(windowLabel, "clear-workspace-history", async () => {
          const { rootPath } = useWorkspaceStore.getState();
          if (!rootPath) return;

          const workspaceName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
          const confirmed = await confirmAction({
            title: i18n.t("dialog:clearHistory.workspaceTitle"),
            message: i18n.t("dialog:clearHistory.workspaceMessage", { workspaceName }),
            actionLabel: i18n.t("dialog:action.clearHistory"),
            kind: "warning",
          });
          if (confirmed) {
            const count = await clearWorkspaceHistory(rootPath);
            historyLog(`Cleared workspace history: ${count} document(s)`);
            emitHistoryCleared();
          }
        });
      },
    },
  ];
}

/** Orphaned-image cleanup for the active document. */
function mediaCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "image.cleanupOrphans",
      title: () => i18n.t("commands:image.cleanupOrphans"),
      category: "image",
      run: async (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        await withReentryGuard(windowLabel, "cleanup-images", async () => {
          const tabId = useTabStore.getState().activeTabId[windowLabel];
          if (!tabId) return;
          const doc = useDocumentStore.getState().getDocument(tabId);
          if (!doc) return;
          const autoCleanupEnabled = useSettingsStore.getState().image.cleanupOrphansOnClose;
          await runOrphanCleanup(
            doc.filePath,
            doc.isDirty ? null : doc.content,
            autoCleanupEnabled,
            // Other open tabs' unsaved buffers — an image only they reference
            // must not be offered for deletion. Passed as a getter so the
            // pre-delete re-scan sees edits made while the dialog was open.
            () => liveContentsExcluding(new Set([tabId])),
            // The subject, re-read at delete time. Null once it is dirty or gone:
            // its content is then no longer what the scan was based on.
            () => {
              const live = useDocumentStore.getState().getDocument(tabId);
              return live && !live.isDirty ? live.content : null;
            },
          );
        });
      },
    },
  ];
}

/** External documentation links. */
function helpCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "help.vmarkHelp",
      title: () => i18n.t("commands:help.vmarkHelp"),
      category: "help",
      run: async () => {
        await openHelpLink(HELP_URL);
      },
    },
    {
      id: "help.keyboardShortcuts",
      title: () => i18n.t("commands:help.keyboardShortcuts"),
      category: "help",
      run: async () => {
        await openHelpLink(SHORTCUTS_URL);
      },
    },
    {
      id: "help.reportIssue",
      title: () => i18n.t("commands:help.reportIssue"),
      category: "help",
      run: async () => {
        await openHelpLink(REPORT_ISSUE_URL);
      },
    },
  ];
}

/** Reveal the Genies folder in the OS file manager, creating it if needed. */
function genieCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "genies.openFolder",
      title: () => i18n.t("commands:genies.openFolder"),
      category: "ai",
      run: async () => {
        try {
          const dir = await invoke<string>("get_genies_dir");
          await mkdir(dir, { recursive: true });
          await revealItemInDir(dir);
        } catch (error) {
          // REPORTED, not just logged (audit #922) — the same defect #921 fixed
          // one command over. A capability refusal or a missing file manager
          // left this menu item visibly doing nothing at all.
          reportCommandFailure(error, { label: "Failed to open genies folder:" });
        }
      },
    },
  ];
}

/** Build the misc command specs (pure — no registration). */
function buildMiscCommandSpecs(): CommandDefinition[] {
  return [
    ...appCommandSpecs(),
    ...historyCommandSpecs(),
    ...mediaCommandSpecs(),
    ...helpCommandSpecs(),
    ...genieCommandSpecs(),
  ];
}

/**
 * Register the misc command set as ONE owner batch (audit #918).
 *
 * `hasCommand("app.preferences")` suppressed every other registration whenever
 * that single id was already taken — by a foreign registrar, or by a batch of
 * this module's own that had thrown after the first command. `registerCommands`
 * preflights the whole set and replaces its own previous batch (#459).
 */
export function registerMiscCommands(): void {
  registerCommands(MISC_COMMANDS_OWNER, buildMiscCommandSpecs());
}
