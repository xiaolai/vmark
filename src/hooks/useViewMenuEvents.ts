/**
 * View Menu Events Hook — ADR-012 migration.
 *
 * Thin shell that registers view-category commands and mounts the
 * menu→command router. Handlers in `services/commands/viewCommands.ts`.
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerViewCommands } from "@/services/commands/viewCommands";
import { mountMenuCommands } from "@/services/commands/menuListener";

const BINDINGS = [
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
  { menuEvent: "menu:toggle-terminal", commandId: "view.toggleTerminal" },
  { menuEvent: "menu:zoom-actual", commandId: "view.zoomActual" },
  { menuEvent: "menu:zoom-in", commandId: "view.zoomIn" },
  { menuEvent: "menu:zoom-out", commandId: "view.zoomOut" },
  { menuEvent: "menu:check-markdown", commandId: "lint.check" },
  { menuEvent: "menu:lint-next", commandId: "lint.next" },
  { menuEvent: "menu:lint-prev", commandId: "lint.prev" },
];

export function useViewMenuEvents(): void {
  useEffect(() => {
    registerViewCommands();
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const off = await mountMenuCommands(BINDINGS);
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
