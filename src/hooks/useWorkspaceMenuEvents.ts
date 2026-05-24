/**
 * Workspace Menu Events Hook — ADR-012 migration.
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerWorkspaceCommands } from "@/services/commands/workspaceCommands";
import { mountMenuCommands } from "@/services/commands/menuListener";

const BINDINGS = [
  { menuEvent: "menu:open-folder", commandId: "workspace.openFolder" },
  { menuEvent: "menu:close-workspace", commandId: "workspace.close" },
];

export function useWorkspaceMenuEvents(): void {
  useEffect(() => {
    registerWorkspaceCommands();
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
