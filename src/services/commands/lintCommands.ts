/**
 * Lint commands — the markdown-lint command set, split out of viewCommands.ts
 * for the file-size gate. These are `lint.*`, a namespace of their own rather
 * than a corner of `view.*`, so they were the natural seam. Registered by
 * `registerViewCommands()`, so callers and tests keep a single entry point.
 */

import { hasCommand, registerCommand } from "./CommandBus";
import { useLintStore } from "@/stores/documentStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { scrollToSelectedDiagnostic } from "@/services/lint/lintNavigation";
import { runActiveLint } from "@/services/lint/runActiveLint";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

/** Move the lint selection and scroll the editor to whatever is now selected. */
function step(windowLabel: string, direction: "next" | "prev"): void {
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) return;
  const lint = useLintStore.getState();
  if (direction === "next") lint.selectNext(tabId);
  else lint.selectPrev(tabId);
  scrollToSelectedDiagnostic(tabId);
}

let registered = false;
export function registerLintCommands(): void {
  if (registered || hasCommand("lint.check")) return; // HMR: module-local flag resets on reload; the bus registry survives

  registerCommand({
    id: "lint.check",
    title: () => i18n.t("commands:lint.check"),
    category: "lint",
    run: (_args, ctx: Ctx) => {
      runActiveLint(ctx.windowLabel ?? "main");
    },
  });

  registerCommand({
    id: "lint.next",
    title: () => i18n.t("commands:lint.next"),
    category: "lint",
    run: (_args, ctx: Ctx) => step(ctx.windowLabel ?? "main", "next"),
  });

  registerCommand({
    id: "lint.prev",
    title: () => i18n.t("commands:lint.prev"),
    category: "lint",
    run: (_args, ctx: Ctx) => step(ctx.windowLabel ?? "main", "prev"),
  });

  registered = true;
}

/** Test-only: reset the module registration guard so a fresh CommandBus can be repopulated. */
export function __resetLintCommandsRegistration(): void {
  registered = false;
}
