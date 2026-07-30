/**
 * Tab commands — CommandBus registration for tab lifecycle + status bar
 * (keybinding Phase 3, migrated from useTabShortcuts).
 *
 * Registered from the hooks tier (not services/commands) because the close
 * action wraps `closeTabWithDirtyCheck` — a hooks/ helper that drives the
 * unsaved-changes save prompt. hooks → hooks is tier-valid; a services/ command
 * module could not import it. Each command mirrors the exact behavior the
 * bespoke hook had (behavior-neutral migration).
 *
 * @coordinates-with useTabOperations.ts — closeTabWithDirtyCheck (dirty prompt)
 * @module hooks/tabCommands
 */

import { registerCommands, type CommandDefinition } from "@/services/commands/CommandBus";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { cycleTabId } from "@/utils/tabCycling";
import { visibleWindowTabs } from "@/hooks/useVisibleWindowTabs";
import { fileOpsError } from "@/utils/debug";
import i18n from "@/i18n";

/** Owner token the whole tab-command batch registers under (HMR-safe, atomic). */
const TAB_COMMANDS_OWNER = "tab-commands";

type Ctx = { windowLabel?: string };
const wl = (ctx: Ctx): string => ctx.windowLabel ?? "main";

/** Build the tab lifecycle + status-bar command specs (pure — no registration). */
function buildTabCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [
    {
      id: "tab.new",
      title: () => i18n.t("commands:tab.new"),
      category: "file",
      run: (_a, ctx: Ctx) => {
        const tabId = useTabStore.getState().createTab(wl(ctx), null);
        useDocumentStore.getState().initDocument(tabId, "", null);
      },
    },
  ];

  for (const [id, direction] of [
    ["tab.next", "next"],
    ["tab.prev", "previous"],
  ] as const) {
    specs.push({
      id,
      title: () => i18n.t(`commands:${id}`),
      category: "file",
      run: (_a, ctx: Ctx) => {
        const windowLabel = wl(ctx);
        const tabState = useTabStore.getState();
        // WI-4R: cycle only the VISIBLE projection — hidden instances' tabs
        // are unreachable by next/prev (rail off = full list, unchanged).
        const ids = visibleWindowTabs(windowLabel).map((t) => t.id);
        const target = cycleTabId(ids, tabState.activeTabId[windowLabel] ?? null, direction);
        if (target) tabState.setActiveTab(windowLabel, target);
      },
    });
  }

  specs.push({
    id: "tab.close",
    title: () => i18n.t("commands:tab.close"),
    category: "file",
    run: (_a, ctx: Ctx) => {
      const windowLabel = wl(ctx);
      const activeTabId = useTabStore.getState().activeTabId[windowLabel];
      if (activeTabId) {
        void closeTabWithDirtyCheck(windowLabel, activeTabId).catch((error) => {
          fileOpsError("tab.close failed:", error);
        });
      }
    },
  });

  specs.push({
    id: "view.toggleStatusBar",
    title: () => i18n.t("commands:view.toggleStatusBar"),
    category: "view",
    run: () => {
      const ui = useUIStore.getState();
      const isCurrentlyVisible = ui.statusBarVisible;
      if (!isCurrentlyVisible) {
        // Showing StatusBar: close the other mutually-exclusive bottom bars.
        ui.searchClose();
        ui.setUniversalToolbarVisible(false);
      }
      ui.setStatusBarVisible(!isCurrentlyVisible);
    },
  });

  return specs;
}

/**
 * Register the tab lifecycle + status-bar commands as ONE atomic batch under the
 * owner token. HMR-safe (replace-own) and partial-batch-proof: a mid-batch id
 * collision throws before anything registers, and a re-mount replaces the whole
 * batch rather than early-returning on a stale first-id guard.
 */
export function registerTabCommands(): void {
  registerCommands(TAB_COMMANDS_OWNER, buildTabCommandSpecs());
}
