/**
 * Recent Files Menu Events Hook — ADR-012 migration.
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerRecentFilesCommands } from "@/services/commands/recentFilesCommands";
import { mountMenuCommands } from "@/services/commands/menuListener";

const BINDINGS = [
  { menuEvent: "menu:clear-recent", commandId: "file.clearRecent" },
  { menuEvent: "menu:open-recent-file", commandId: "file.openRecent" },
];

export function useRecentFilesMenuEvents(): void {
  useEffect(() => {
    registerRecentFilesCommands();
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
