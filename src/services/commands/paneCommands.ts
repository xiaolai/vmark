/**
 * Pane commands — the split-editor command set (#1081), split out of
 * viewCommands.ts for the file-size gate. Registered by
 * `registerViewCommands()`, so callers and tests keep a single entry point.
 */

import { registerCommands, type CommandDefinition } from "./CommandBus";
import { usePaneStore } from "@/stores/paneStore";
import { toggleSplitDocuments } from "@/services/navigation/toggleSplitDocuments";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

/**
 * Whether the window has a LIVE split (audit #924).
 *
 * All three commands below are meaningless without one. `closePane` and
 * `focusOtherPane` already checked internally and did nothing, but the palette
 * listed them anyway — and `toggleSyncScroll` did not check at all, so invoking
 * it with no split flipped latent state that only took effect later, when the
 * user next opened a split and found scroll sync in a mode they never chose.
 * A `when` answers both halves: the palette hides them, and the dispatch is
 * refused rather than silently doing nothing.
 */
function splitIsOpen(ctx: Ctx): boolean {
  return usePaneStore.getState().byWindow[ctx.windowLabel ?? "main"]?.enabled === true;
}

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const PANE_COMMANDS_OWNER = "pane-commands";

/** Build the pane command specs (pure — no registration). */
function buildPaneCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [];
  const add = (command: CommandDefinition): void => void specs.push(command);

  // Two-documents-side-by-side toggle (#1081). Opening seeds the secondary
  // pane with the current document; the user then picks a different file there.
  add({
    id: "view.toggleSplitDocuments",
    title: () => i18n.t("commands:view.toggleSplitDocuments"),
    category: "view",
    run: (_args, ctx: Ctx) => toggleSplitDocuments(ctx.windowLabel ?? "main"),
  });

  // Synchronize scrolling between the two panes (great for bilingual reading).
  add({
    id: "view.toggleSyncScroll",
    title: () => i18n.t("commands:view.toggleSyncScroll"),
    category: "view",
    when: splitIsOpen,
    run: (_args, ctx: Ctx) =>
      usePaneStore.getState().toggleSyncScroll(ctx.windowLabel ?? "main"),
  });

  add({
    id: "view.closePane",
    title: () => i18n.t("commands:view.closePane"),
    category: "view",
    when: splitIsOpen,
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      if (usePaneStore.getState().byWindow[windowLabel]?.enabled) {
        usePaneStore.getState().closeSplit(windowLabel);
      }
    },
  });

  add({
    id: "view.focusOtherPane",
    title: () => i18n.t("commands:view.focusOtherPane"),
    category: "view",
    when: splitIsOpen,
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

  return specs;
}

/** Register the split-editor command set as one owner batch (audit #459). */
export function registerPaneCommands(): void {
  registerCommands(PANE_COMMANDS_OWNER, buildPaneCommandSpecs());
}
