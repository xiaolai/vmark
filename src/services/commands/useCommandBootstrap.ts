/**
 * useCommandBootstrap — single menu-events bootstrap (T06).
 *
 * Replaces the six legacy `use*MenuEvents` hooks. Registers every
 * command surface once, then mounts a single Tauri menu-event
 * dispatcher that routes every `menu:*` event through CommandBus.
 *
 * Order contract:
 *   1. Sync registrations run first (idempotent — each register* is
 *      a no-op on the second call).
 *   2. Async Pandoc-format expansion runs next; the format list is
 *      not known until pandocExport.ts dynamically loads.
 *   3. The combined binding list is mounted via mountMenuCommands.
 *
 * @module services/commands/useCommandBootstrap
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { menuError } from "@/utils/debug";
import { mountMenuCommands, type MenuCommandBinding } from "./menuListener";
import { registerExportCommands, registerPandocFormatCommands } from "./exportCommands";
import { registerMiscCommands } from "./miscCommands";
import { registerRecentFilesCommands } from "./recentFilesCommands";
import { registerRecentWorkspacesCommands } from "./recentWorkspacesCommands";
import { registerViewCommands } from "./viewCommands";
import { registerWorkspaceCommands } from "./workspaceCommands";
import { registerFormatCommands } from "./formatCommands";

const EXPORT_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:export-html", commandId: "export.html" },
  { menuEvent: "menu:export-pdf", commandId: "export.pdf" },
  { menuEvent: "menu:export-pdf-native", commandId: "export.pdfNative" },
  { menuEvent: "menu:export-pandoc-hint", commandId: "export.pandocHint" },
  { menuEvent: "menu:copy-html", commandId: "export.copyHtml" },
];

const MISC_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:preferences", commandId: "app.preferences" },
  { menuEvent: "menu:clear-history", commandId: "history.clearAll" },
  { menuEvent: "menu:clear-workspace-history", commandId: "history.clearWorkspace" },
  { menuEvent: "menu:cleanup-images", commandId: "image.cleanupOrphans" },
  { menuEvent: "menu:vmark-help", commandId: "help.vmarkHelp" },
  { menuEvent: "menu:keyboard-shortcuts", commandId: "help.keyboardShortcuts" },
  { menuEvent: "menu:report-issue", commandId: "help.reportIssue" },
  { menuEvent: "menu:open-genies-folder", commandId: "genies.openFolder" },
];

const RECENT_FILES_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:clear-recent", commandId: "file.clearRecent" },
  { menuEvent: "menu:open-recent-file", commandId: "file.openRecent" },
];

const RECENT_WORKSPACES_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:clear-recent-workspaces", commandId: "workspace.clearRecent" },
  { menuEvent: "menu:open-recent-workspace", commandId: "workspace.openRecent" },
];

const VIEW_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:source-mode", commandId: "view.toggleSourceMode" },
  { menuEvent: "menu:focus-mode", commandId: "view.toggleFocusMode" },
  { menuEvent: "menu:typewriter-mode", commandId: "view.toggleTypewriterMode" },
  { menuEvent: "menu:outline", commandId: "view.toggleOutline" },
  { menuEvent: "menu:file-explorer", commandId: "view.toggleFileExplorer" },
  { menuEvent: "menu:view-history", commandId: "view.toggleHistory" },
  { menuEvent: "menu:word-wrap", commandId: "view.toggleWordWrap" },
  { menuEvent: "menu:line-numbers", commandId: "view.toggleLineNumbers" },
  { menuEvent: "menu:diagram-preview", commandId: "view.toggleDiagramPreview" },
  { menuEvent: "menu:fit-tables", commandId: "view.toggleFitTables" },
  { menuEvent: "menu:read-only", commandId: "view.toggleReadOnly" },
  { menuEvent: "menu:show-invisibles", commandId: "view.toggleShowInvisibles" },
  { menuEvent: "menu:toggle-terminal", commandId: "view.toggleTerminal" },
  { menuEvent: "menu:zoom-actual", commandId: "view.zoomActual" },
  { menuEvent: "menu:zoom-in", commandId: "view.zoomIn" },
  { menuEvent: "menu:zoom-out", commandId: "view.zoomOut" },
  { menuEvent: "menu:check-markdown", commandId: "lint.check" },
  { menuEvent: "menu:lint-next", commandId: "lint.next" },
  { menuEvent: "menu:lint-prev", commandId: "lint.prev" },
];

const WORKSPACE_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:open-folder", commandId: "workspace.openFolder" },
  { menuEvent: "menu:close-workspace", commandId: "workspace.close" },
];

export function useCommandBootstrap(): void {
  useEffect(() => {
    registerMiscCommands();
    registerExportCommands();
    registerWorkspaceCommands();
    registerRecentFilesCommands();
    registerRecentWorkspacesCommands();
    registerViewCommands();
    registerFormatCommands();

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const bindings: MenuCommandBinding[] = [
        ...MISC_BINDINGS,
        ...EXPORT_BINDINGS,
        ...WORKSPACE_BINDINGS,
        ...RECENT_FILES_BINDINGS,
        ...RECENT_WORKSPACES_BINDINGS,
        ...VIEW_BINDINGS,
      ];

      try {
        const formats = await registerPandocFormatCommands();
        for (const fmt of formats) {
          bindings.push({
            menuEvent: `menu:export-pandoc-${fmt}`,
            commandId: `export.pandoc-${fmt}`,
          });
        }
      } catch (err) {
        menuError("Failed to expand Pandoc menu bindings:", err);
      }

      const off = await mountMenuCommands(bindings);
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
