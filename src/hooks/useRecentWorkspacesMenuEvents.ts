/**
 * Recent Workspaces Menu Events Hook — ADR-012 migration.
 *
 * Thin shell that registers recent-workspaces commands with CommandBus
 * and mounts the menu→command router. Original handlers moved to
 * `services/commands/recentWorkspacesCommands.ts`.
 *
 * @module hooks/useRecentWorkspacesMenuEvents
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerRecentWorkspacesCommands } from "@/services/commands/recentWorkspacesCommands";
import { mountMenuCommands } from "@/services/commands/menuListener";

const BINDINGS = [
  { menuEvent: "menu:clear-recent-workspaces", commandId: "workspace.clearRecent" },
  { menuEvent: "menu:open-recent-workspace", commandId: "workspace.openRecent" },
];

export function useRecentWorkspacesMenuEvents(): void {
  useEffect(() => {
    registerRecentWorkspacesCommands();
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
