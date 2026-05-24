/**
 * Misc commands — ADR-012 migration of useMenuEvents.
 *
 * Handles preferences, history clearing, orphan-image cleanup, help links,
 * and the open-genies-folder action.
 */

import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { registerCommand } from "./CommandBus";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { clearAllHistory, clearWorkspaceHistory } from "@/hooks/useHistoryRecovery";
import { historyLog, historyError, menuError } from "@/utils/debug";
import { emitHistoryCleared } from "@/utils/historyTypes";
import { withReentryGuard } from "@/utils/reentryGuard";
import { runOrphanCleanup } from "@/utils/orphanAssetCleanup";
import { openSettingsWindow } from "@/utils/settingsWindow";

const HELP_URL = "https://vmark.app/guide/";
const SHORTCUTS_URL = "https://vmark.app/guide/shortcuts";
const REPORT_ISSUE_URL = "https://github.com/xiaolai/vmark/issues/new";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerMiscCommands(): void {
  if (registered) return;

  registerCommand({
    id: "app.preferences",
    title: "Preferences",
    category: "app",
    run: async () => {
      await openSettingsWindow();
    },
  });

  registerCommand({
    id: "history.clearAll",
    title: "Clear All History",
    category: "history",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      await withReentryGuard(windowLabel, "clear-history", async () => {
        const confirmed = await ask(
          i18n.t("dialog:clearHistory.allMessage"),
          { title: i18n.t("dialog:clearHistory.allTitle"), kind: "warning" }
        );
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
  });

  registerCommand({
    id: "history.clearWorkspace",
    title: "Clear Workspace History",
    category: "history",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      await withReentryGuard(windowLabel, "clear-workspace-history", async () => {
        const { rootPath } = useWorkspaceStore.getState();
        if (!rootPath) return;

        const workspaceName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
        const confirmed = await ask(
          i18n.t("dialog:clearHistory.workspaceMessage", { workspaceName }),
          { title: i18n.t("dialog:clearHistory.workspaceTitle"), kind: "warning" }
        );
        if (confirmed) {
          const count = await clearWorkspaceHistory(rootPath);
          historyLog(`Cleared workspace history: ${count} document(s)`);
          emitHistoryCleared();
        }
      });
    },
  });

  registerCommand({
    id: "image.cleanupOrphans",
    title: "Clean Up Unused Images",
    category: "image",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      await withReentryGuard(windowLabel, "cleanup-images", async () => {
        const tabId = useTabStore.getState().activeTabId[windowLabel];
        if (!tabId) return;
        const doc = useDocumentStore.getState().getDocument(tabId);
        if (!doc) return;
        const autoCleanupEnabled = useSettingsStore.getState().image.cleanupOrphansOnClose;
        await runOrphanCleanup(doc.filePath, doc.isDirty ? null : doc.content, autoCleanupEnabled);
      });
    },
  });

  registerCommand({
    id: "help.vmarkHelp",
    title: "VMark Help",
    category: "help",
    run: async () => {
      await openUrl(HELP_URL);
    },
  });

  registerCommand({
    id: "help.keyboardShortcuts",
    title: "Keyboard Shortcuts",
    category: "help",
    run: async () => {
      await openUrl(SHORTCUTS_URL);
    },
  });

  registerCommand({
    id: "help.reportIssue",
    title: "Report an Issue",
    category: "help",
    run: async () => {
      await openUrl(REPORT_ISSUE_URL);
    },
  });

  registerCommand({
    id: "genies.openFolder",
    title: "Open Genies Folder",
    category: "ai",
    run: async () => {
      try {
        const dir = await invoke<string>("get_genies_dir");
        await mkdir(dir, { recursive: true });
        await revealItemInDir(dir);
      } catch (error) {
        menuError("Failed to open genies folder:", error);
      }
    },
  });

  registered = true;
}
