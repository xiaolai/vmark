/**
 * Pane commands — the split-editor command set (#1081), split out of
 * viewCommands.ts for the file-size gate. Registered by
 * `registerViewCommands()`, so callers and tests keep a single entry point.
 */

import { hasCommand, registerCommand } from "./CommandBus";
import { usePaneStore } from "@/stores/paneStore";
import { toggleSplitDocuments } from "@/services/navigation/toggleSplitDocuments";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

let registered = false;
export function registerPaneCommands(): void {
  if (registered || hasCommand("view.toggleSplitDocuments")) return; // HMR: module-local flag resets on reload; the bus registry survives

  // Two-documents-side-by-side toggle (#1081). Opening seeds the secondary
  // pane with the current document; the user then picks a different file there.
  registerCommand({
    id: "view.toggleSplitDocuments",
    title: () => i18n.t("commands:view.toggleSplitDocuments"),
    category: "view",
    run: (_args, ctx: Ctx) => toggleSplitDocuments(ctx.windowLabel ?? "main"),
  });

  // Synchronize scrolling between the two panes (great for bilingual reading).
  registerCommand({
    id: "view.toggleSyncScroll",
    title: () => i18n.t("commands:view.toggleSyncScroll"),
    category: "view",
    run: (_args, ctx: Ctx) =>
      usePaneStore.getState().toggleSyncScroll(ctx.windowLabel ?? "main"),
  });

  registerCommand({
    id: "view.closePane",
    title: () => i18n.t("commands:view.closePane"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      if (usePaneStore.getState().byWindow[windowLabel]?.enabled) {
        usePaneStore.getState().closeSplit(windowLabel);
      }
    },
  });

  registerCommand({
    id: "view.focusOtherPane",
    title: () => i18n.t("commands:view.focusOtherPane"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const pane = usePaneStore.getState();
      const split = pane.byWindow[windowLabel];
      if (split?.enabled) {
        const next = split.focusedPane === "primary" ? "secondary" : "primary";
        pane.setFocusedPane(windowLabel, next);
      }
    },
  });

  registered = true;
}

/** Test-only: reset the module registration guard so a fresh CommandBus can be repopulated. */
export function __resetPaneCommandsRegistration(): void {
  registered = false;
}
