/**
 * Export Menu Events Hook — ADR-012 migration.
 *
 * Thin shell over CommandBus: registers the export commands once and
 * mounts a single menu-event router that dispatches into the bus.
 * Original inline handlers moved to `services/commands/exportCommands.ts`.
 *
 * @module hooks/useExportMenuEvents
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { registerExportCommands, registerPandocFormatCommands } from "@/services/commands/exportCommands";
import {
  mountMenuCommands,
  type MenuCommandBinding,
} from "@/services/commands/menuListener";
import { menuError } from "@/utils/debug";

const STATIC_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:export-html", commandId: "export.html" },
  { menuEvent: "menu:export-pdf", commandId: "export.pdf" },
  { menuEvent: "menu:export-pdf-native", commandId: "export.pdfNative" },
  { menuEvent: "menu:export-pandoc-hint", commandId: "export.pandocHint" },
  { menuEvent: "menu:copy-html", commandId: "export.copyHtml" },
];

export function useExportMenuEvents(): void {
  useEffect(() => {
    registerExportCommands();
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const bindings = [...STATIC_BINDINGS];
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
