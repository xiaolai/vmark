/**
 * Misc Menu Events Hook — ADR-012 migration.
 *
 * Thin shell that registers misc commands and mounts the menu→command
 * router. Original handlers moved to `services/commands/miscCommands.ts`.
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerMiscCommands } from "@/services/commands/miscCommands";
import { mountMenuCommands } from "@/services/commands/menuListener";

const BINDINGS = [
  { menuEvent: "menu:preferences", commandId: "app.preferences" },
  { menuEvent: "menu:clear-history", commandId: "history.clearAll" },
  { menuEvent: "menu:clear-workspace-history", commandId: "history.clearWorkspace" },
  { menuEvent: "menu:cleanup-images", commandId: "image.cleanupOrphans" },
  { menuEvent: "menu:vmark-help", commandId: "help.vmarkHelp" },
  { menuEvent: "menu:keyboard-shortcuts", commandId: "help.keyboardShortcuts" },
  { menuEvent: "menu:report-issue", commandId: "help.reportIssue" },
  { menuEvent: "menu:open-genies-folder", commandId: "genies.openFolder" },
];

export function useMenuEvents(): void {
  useEffect(() => {
    registerMiscCommands();
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
