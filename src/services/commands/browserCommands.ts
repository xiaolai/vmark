/**
 * Browser commands — the user-facing entry point to the embedded browser (WI-1.10).
 *
 * A single "New Browser Tab" command, gated by the `browser.enabled` setting
 * (off by default) via the CommandBus `when` predicate, so the palette/menu
 * simply don't surface it until the user opts in. Mirrors viewCommands'
 * registration pattern. The command creates (and activates) a browser tab, which
 * `Editor.tsx` renders as a `BrowserSurface` for `kind === "browser"`.
 *
 * @coordinates-with stores/settingsStore — the `browser.enabled` gate
 * @coordinates-with stores/tabStore — createBrowserTab
 * @module services/commands/browserCommands
 */
import { hasCommand, registerCommand } from "./CommandBus";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import i18n from "@/i18n";

/**
 * Default start page for a new browser tab. DuckDuckGo is a privacy-respecting
 * neutral default; it is not yet a user setting (a `browser.homepage` setting is
 * a natural follow-up).
 */
export const NEW_BROWSER_TAB_URL = "https://duckduckgo.com";

type Ctx = { windowLabel?: string };

/**
 * Register the browser commands on the CommandBus. Idempotent: guards on
 * `hasCommand` (bus state), which is HMR-safe (the bus survives a module reload)
 * and reset-aware (re-registers after `_resetCommandBus` in tests).
 */
export function registerBrowserCommands(): void {
  if (hasCommand("browser.newTab")) return;

  registerCommand({
    id: "browser.newTab",
    title: () => i18n.t("commands:browser.newTab"),
    category: "view",
    when: () => useSettingsStore.getState().browser.enabled,
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      useTabStore.getState().createBrowserTab(windowLabel, NEW_BROWSER_TAB_URL);
    },
  });
}
